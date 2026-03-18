"""
emailer.py — Génération d'emails personnalisés + envoi/tracking via HubSpot CRM.

Entrée : data/contacts_enrichis.json + templates/
Sortie  : emails envoyés via HubSpot API, contacts créés dans le CRM
"""

import json
import logging
import os
import random
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from string import Template

import yaml

try:
    import anthropic
except ImportError:
    anthropic = None

try:
    import requests as _requests
except ImportError:
    _requests = None


logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
DATA_DIR = ROOT / "data"
TEMPLATES_DIR = ROOT / "templates"

MAX_RETRIES = 3
RETRY_DELAY_BASE = 2

HUBSPOT_BASE_URL = "https://api.hubapi.com"


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _load_template(template_name: str) -> str:
    """Charge un template email depuis templates/."""
    path = TEMPLATES_DIR / template_name
    if not path.exists():
        raise FileNotFoundError(
            f"Template introuvable : {path}. "
            f"Templates disponibles : {[f.name for f in TEMPLATES_DIR.glob('*.txt')]}"
        )
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _extract_first_name(full_name: str) -> str:
    """Extrait le prénom d'un nom complet."""
    if not full_name:
        return ""
    parts = full_name.strip().split()
    if not parts:
        return ""
    return parts[0].capitalize()


# ============================================================
# Génération d'emails (IA + template)
# ============================================================


def generate_email_with_ai(
    client,
    contact: dict,
    template: str,
    config: dict,
) -> dict:
    """Génère un email personnalisé via Claude Haiku."""
    prenom = contact.get("prenom") or _extract_first_name(contact.get("nom", ""))
    entreprise = contact.get("entreprise", "votre entreprise")
    titre = contact.get("titre", "")
    secteur = contact.get("secteur_entreprise", "")
    scoring = contact.get("scoring_entreprise", {})

    mode = config.get("mode", "levee_de_fonds")
    if mode == "levee_de_fonds":
        contexte_mode = "accompagnement en levée de fonds"
    else:
        contexte_mode = "conseil en cession/acquisition d'entreprise"

    prompt = f"""Tu es un expert en prospection B2B. Génère un email de prospection personnalisé.

TEMPLATE DE BASE :
{template}

DONNÉES DU CONTACT :
- Prénom : {prenom}
- Entreprise : {entreprise}
- Titre : {titre}
- Secteur : {secteur}
- Signaux positifs : {json.dumps(scoring.get('signaux_positifs', []), ensure_ascii=False)}

CONTEXTE :
- Notre offre : {contexte_mode}
- Ton : professionnel mais chaleureux, pas commercial agressif
- Longueur : 4-6 phrases max dans le corps

RÈGLES STRICTES :
1. Personnalise avec au moins 1 élément spécifique au contact/entreprise
2. N'invente JAMAIS de faits — utilise uniquement les données fournies
3. Pas de formules cliché ("j'espère que vous allez bien", "je me permets de")
4. Appel à l'action clair et simple (proposition d'échange, pas de vente directe)

Réponds UNIQUEMENT avec un JSON valide :
{{
  "sujet": "<objet de l'email>",
  "corps": "<corps de l'email en texte brut>",
  "hook": "<l'accroche personnalisée utilisée>"
}}"""

    for attempt in range(MAX_RETRIES):
        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()

            # Nettoyer markdown
            if raw.startswith("```"):
                lines = raw.split("\n")
                lines = [l for l in lines if not l.strip().startswith("```")]
                raw = "\n".join(lines)

            return json.loads(raw)

        except json.JSONDecodeError:
            # Tenter extraction
            match = re.search(r'\{.*"sujet".*"corps".*\}', raw, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            if attempt == MAX_RETRIES - 1:
                return {"sujet": "", "corps": "", "erreur": "Génération échouée"}
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                return {"sujet": "", "corps": "", "erreur": str(e)}
            time.sleep(RETRY_DELAY_BASE ** (attempt + 1))

    return {"sujet": "", "corps": "", "erreur": "Max retries"}


def generate_email_from_template(contact: dict, template: str, config: dict) -> dict:
    """Génère un email à partir du template sans IA (fallback)."""
    prenom = contact.get("prenom") or _extract_first_name(contact.get("nom", ""))
    entreprise = contact.get("entreprise", "votre entreprise")
    titre = contact.get("titre", "")

    mode = config.get("mode", "levee_de_fonds")
    if mode == "levee_de_fonds":
        offre = "accompagnement en levée de fonds"
    else:
        offre = "conseil en cession d'entreprise"

    try:
        t = Template(template)
        corps = t.safe_substitute(
            prenom=prenom,
            entreprise=entreprise,
            titre=titre,
            offre=offre,
        )
    except Exception:
        corps = template

    return {
        "sujet": f"{entreprise} — échange sur votre développement",
        "corps": corps,
    }


def _is_within_sending_window(config: dict) -> bool:
    """Vérifie si on est dans la fenêtre d'envoi."""
    now = datetime.now()
    heure_debut = config.get("heure_debut_envoi", "09:00")
    heure_fin = config.get("heure_fin_envoi", "17:30")

    h_debut, m_debut = map(int, heure_debut.split(":"))
    h_fin, m_fin = map(int, heure_fin.split(":"))

    debut = now.replace(hour=h_debut, minute=m_debut, second=0)
    fin = now.replace(hour=h_fin, minute=m_fin, second=0)

    # Pas d'envoi le weekend
    if now.weekday() >= 5:
        return False

    return debut <= now <= fin


# ============================================================
# Client HubSpot API
# ============================================================


def _hubspot_headers() -> dict:
    """Headers d'authentification HubSpot (Private App token)."""
    token = os.environ.get("HUBSPOT_ACCESS_TOKEN", "")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _hubspot_upsert_contact(contact: dict, owner_id: str = "") -> int | None:
    """
    Crée ou met à jour un contact dans HubSpot CRM.
    Retourne le contact ID, ou None en cas d'erreur.
    Utilise l'email comme clé de déduplication.
    """
    if _requests is None:
        return None

    email = contact.get("email", "")
    if not email:
        return None

    prenom = contact.get("prenom") or _extract_first_name(contact.get("nom", ""))
    nom_complet = contact.get("nom", "")
    if " " in nom_complet:
        nom_famille = nom_complet.split(" ", 1)[1]
    else:
        nom_famille = nom_complet

    properties = {
        "email": email,
        "firstname": prenom,
        "lastname": nom_famille,
        "jobtitle": contact.get("titre", ""),
        "company": contact.get("entreprise", ""),
    }
    if contact.get("telephone"):
        properties["phone"] = contact["telephone"]
    if contact.get("linkedin"):
        properties["linkedin"] = contact["linkedin"]
    if owner_id:
        properties["hubspot_owner_id"] = owner_id

    # Tenter la création d'abord
    url = f"{HUBSPOT_BASE_URL}/crm/v3/objects/contacts"
    try:
        resp = _requests.post(url, headers=_hubspot_headers(), json={"properties": properties}, timeout=15)
        if resp.status_code == 201:
            return resp.json().get("id")
        elif resp.status_code == 409:
            # Contact existe déjà — récupérer l'ID et mettre à jour
            conflict_data = resp.json()
            existing_id = conflict_data.get("message", "")
            # Extraire l'ID du message "Contact already exists. Existing ID: 123"
            import re as _re
            id_match = _re.search(r"Existing ID:\s*(\d+)", existing_id)
            if id_match:
                contact_id = int(id_match.group(1))
                # Mettre à jour le contact existant
                update_url = f"{HUBSPOT_BASE_URL}/crm/v3/objects/contacts/{contact_id}"
                _requests.patch(update_url, headers=_hubspot_headers(), json={"properties": properties}, timeout=15)
                return contact_id
        resp.raise_for_status()
    except Exception as e:
        logger.error("HubSpot upsert contact erreur: %s", e)

    return None


def _hubspot_create_email_engagement(
    contact_id: int,
    email_content: dict,
    sender_email: str,
    recipient_email: str,
    status: str = "SENT",
) -> dict:
    """
    Crée un engagement email dans HubSpot, associé au contact.
    Status : SENT (envoyé) ou DRAFT (brouillon).
    """
    if _requests is None:
        return {"sent": False, "error": "pip install requests requis"}

    timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")

    properties = {
        "hs_email_subject": email_content.get("sujet", ""),
        "hs_email_html": email_content.get("corps", "").replace("\n", "<br>"),
        "hs_email_direction": "EMAIL",  # outgoing
        "hs_email_status": status,
        "hs_email_from_email": sender_email,
        "hs_email_to_email": recipient_email,
        "hs_timestamp": timestamp,
    }

    # Créer l'email
    url = f"{HUBSPOT_BASE_URL}/crm/v3/objects/emails"
    try:
        resp = _requests.post(url, headers=_hubspot_headers(), json={"properties": properties}, timeout=15)
        resp.raise_for_status()
        email_id = resp.json().get("id")

        # Associer l'email au contact
        if email_id and contact_id:
            assoc_url = (
                f"{HUBSPOT_BASE_URL}/crm/v4/objects/emails/{email_id}"
                f"/associations/contacts/{contact_id}"
            )
            _requests.put(
                assoc_url,
                headers=_hubspot_headers(),
                json=[{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 198}],
                timeout=15,
            )

        return {"sent": True, "message_id": email_id, "hubspot_contact_id": contact_id}

    except Exception as e:
        logger.error("HubSpot create email erreur: %s", e)
        return {"sent": False, "error": f"HubSpot API error: {e}"}


def send_via_hubspot(
    contact: dict,
    email_content: dict,
    sender_email: str,
    sender_name: str,
    owner_id: str = "",
) -> dict:
    """Crée le contact dans HubSpot CRM et enregistre l'email envoyé."""
    token = os.environ.get("HUBSPOT_ACCESS_TOKEN")
    if not token:
        return {"sent": False, "error": "HUBSPOT_ACCESS_TOKEN non défini"}

    if _requests is None:
        return {"sent": False, "error": "pip install requests requis"}

    if not contact.get("email"):
        return {"sent": False, "error": "Email du contact manquant"}

    if not email_content.get("sujet") or not email_content.get("corps"):
        return {"sent": False, "error": "Contenu email incomplet"}

    # 1. Upsert contact dans le CRM
    contact_id = _hubspot_upsert_contact(contact, owner_id)
    if contact_id is None:
        return {"sent": False, "error": "Impossible de créer le contact HubSpot"}

    # 2. Créer l'engagement email
    result = _hubspot_create_email_engagement(
        contact_id=contact_id,
        email_content=email_content,
        sender_email=sender_email,
        recipient_email=contact["email"],
        status="SENT",
    )

    return result


# ============================================================
# Orchestration campagne
# ============================================================


def run_email_campaign(
    contacts_path: str | None = None,
    template_name: str = "premier_contact.txt",
    dry_run: bool = True,
    sender_email: str = "",
    sender_name: str = "",
    use_ai: bool = True,
) -> dict:
    """
    Point d'entrée. Génère et envoie les emails via HubSpot.
    dry_run=True : génère sans envoyer (par défaut, sécurité).
    """
    config = load_config()
    DATA_DIR.mkdir(exist_ok=True)

    # Charger contacts
    if contacts_path is None:
        contacts_path = str(DATA_DIR / "contacts_enrichis.json")

    path = Path(contacts_path)
    if not path.exists():
        return {"status": "error", "message": f"Fichier introuvable : {contacts_path}"}

    with open(path, "r", encoding="utf-8") as f:
        contacts = json.load(f)

    if not contacts:
        return {"status": "empty", "message": "Aucun contact à contacter"}

    # Charger template
    try:
        template = _load_template(template_name)
    except FileNotFoundError as e:
        return {"status": "error", "message": str(e)}

    # Limiter au quota journalier
    max_par_jour = config.get("envoi_par_jour", 15)
    contacts_batch = contacts[:max_par_jour]

    # Client IA si besoin
    ai_client = None
    if use_ai and anthropic is not None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if api_key:
            ai_client = anthropic.Anthropic(api_key=api_key)

    # Owner ID HubSpot (optionnel, depuis config)
    owner_id = config.get("hubspot_owner_id", "")

    results = []
    for contact in contacts_batch:
        # Générer l'email
        if ai_client:
            email_content = generate_email_with_ai(ai_client, contact, template, config)
        else:
            email_content = generate_email_from_template(contact, template, config)

        entry = {
            "contact": contact.get("nom", ""),
            "email": contact.get("email", ""),
            "entreprise": contact.get("entreprise", ""),
            "sujet": email_content.get("sujet", ""),
            "preview": (email_content.get("corps", ""))[:100] + "...",
        }

        if dry_run:
            entry["status"] = "dry_run"
            entry["corps_complet"] = email_content.get("corps", "")
        else:
            # Vérifier la fenêtre d'envoi
            if not _is_within_sending_window(config):
                entry["status"] = "hors_fenetre"
                results.append(entry)
                continue

            # Envoi réel via HubSpot
            send_result = send_via_hubspot(
                contact, email_content, sender_email, sender_name, owner_id
            )
            entry.update(send_result)

            # Délai aléatoire entre emails
            delay_min = config.get("delai_entre_emails_min", 180)
            delay_max = config.get("delai_entre_emails_max", 420)
            if not dry_run and contact != contacts_batch[-1]:
                time.sleep(random.randint(delay_min, delay_max))

        results.append(entry)

    # Sauvegarder le rapport
    report_path = DATA_DIR / f"rapport_envoi_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    sent_count = sum(1 for r in results if r.get("sent"))
    return {
        "status": "ok",
        "mode": "dry_run" if dry_run else "envoi_reel",
        "total_contacts": len(contacts),
        "batch_size": len(contacts_batch),
        "envoyes": sent_count,
        "rapport": str(report_path),
    }


if __name__ == "__main__":
    import sys
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")

    # Par défaut : dry run (sécurité)
    dry = "--send" not in sys.argv
    result = run_email_campaign(dry_run=dry)
    print(json.dumps(result, ensure_ascii=False, indent=2))
