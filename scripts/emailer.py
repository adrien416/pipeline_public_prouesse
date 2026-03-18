"""
emailer.py — Génération d'emails personnalisés + envoi via Brevo.

Entrée : data/contacts_enrichis.json + templates/
Sortie  : emails envoyés via Brevo API
"""

import json
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
    import sib_api_v3_sdk
    from sib_api_v3_sdk.rest import ApiException
except ImportError:
    sib_api_v3_sdk = None


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
DATA_DIR = ROOT / "data"
TEMPLATES_DIR = ROOT / "templates"

MAX_RETRIES = 3
RETRY_DELAY_BASE = 2


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


def send_via_brevo(
    contact: dict,
    email_content: dict,
    sender_email: str,
    sender_name: str,
) -> dict:
    """Envoie un email via l'API Brevo."""
    if sib_api_v3_sdk is None:
        return {"sent": False, "error": "pip install sib-api-v3-sdk requis"}

    api_key = os.environ.get("BREVO_API_KEY")
    if not api_key:
        return {"sent": False, "error": "BREVO_API_KEY non définie"}

    if not contact.get("email"):
        return {"sent": False, "error": "Email du contact manquant"}

    if not email_content.get("sujet") or not email_content.get("corps"):
        return {"sent": False, "error": "Contenu email incomplet"}

    configuration = sib_api_v3_sdk.Configuration()
    configuration.api_key["api-key"] = api_key
    api_instance = sib_api_v3_sdk.TransactionalEmailsApi(
        sib_api_v3_sdk.ApiClient(configuration)
    )

    send_smtp_email = sib_api_v3_sdk.SendSmtpEmail(
        to=[{"email": contact["email"], "name": contact.get("nom", "")}],
        sender={"email": sender_email, "name": sender_name},
        subject=email_content["sujet"],
        text_content=email_content["corps"],
        headers={"X-Mailin-Tag": "prospection-outbound"},
    )

    for attempt in range(MAX_RETRIES):
        try:
            response = api_instance.send_transac_email(send_smtp_email)
            return {"sent": True, "message_id": response.message_id}
        except ApiException as e:
            if e.status == 429:  # Rate limit
                time.sleep(RETRY_DELAY_BASE ** (attempt + 1))
            elif attempt == MAX_RETRIES - 1:
                return {"sent": False, "error": f"Brevo API error {e.status}: {e.reason}"}
            else:
                time.sleep(RETRY_DELAY_BASE)

    return {"sent": False, "error": "Max retries Brevo"}


def run_email_campaign(
    contacts_path: str | None = None,
    template_name: str = "premier_contact.txt",
    dry_run: bool = True,
    sender_email: str = "",
    sender_name: str = "",
    use_ai: bool = True,
) -> dict:
    """
    Point d'entrée. Génère et envoie les emails.
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

            # Envoi réel
            send_result = send_via_brevo(
                contact, email_content, sender_email, sender_name
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
