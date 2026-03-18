"""
enricher.py — Enrichissement des contacts pour les entreprises qualifiées.

Enrichit les emails via l'API Fullenrich (waterfall multi-providers).
Accepte aussi des données pré-enrichies en JSON/CSV.
Entrée : data/boites_qualifiees.json
Sortie  : data/contacts_enrichis.json + data/incomplets.json
"""

import json
import logging
import os
import re
import time
from pathlib import Path

import yaml

try:
    import requests as _requests
except ImportError:
    _requests = None

logger = logging.getLogger(__name__)


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
DATA_DIR = ROOT / "data"


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _validate_email(email: str) -> bool:
    """Validation basique d'email."""
    if not email or not isinstance(email, str):
        return False
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    return bool(re.match(pattern, email.strip()))


def _normalize_title(title: str) -> str:
    """Normalise un titre pour le matching."""
    title = title.strip().upper()
    # Mappings courants
    mappings = {
        "CHIEF EXECUTIVE OFFICER": "CEO",
        "DIRECTEUR GÉNÉRAL": "DG",
        "DIRECTEUR GENERAL": "DG",
        "MANAGING DIRECTOR": "DG",
        "DIRECTEUR ASSOCIÉ": "ASSOCIÉ",
        "DIRECTEUR ASSOCIE": "ASSOCIÉ",
        "PARTNER": "ASSOCIÉ",
        "ASSOCIE": "ASSOCIÉ",
        "INVESTMENT DIRECTOR": "DIRECTEUR INVESTISSEMENT",
        "CHIEF FINANCIAL OFFICER": "CFO",
        "CHIEF OPERATING OFFICER": "COO",
        "CHIEF TECHNOLOGY OFFICER": "CTO",
        "FONDATEUR": "CEO",
        "FOUNDER": "CEO",
        "CO-FOUNDER": "CEO",
        "CO-FONDATEUR": "CEO",
        "PRÉSIDENT": "CEO",
        "PRESIDENT": "CEO",
    }
    return mappings.get(title, title)


def _matches_target_titles(title: str, config: dict) -> bool:
    """Vérifie si un titre correspond aux cibles."""
    titre_cibles = config.get("titre_cibles", [])
    if not titre_cibles:
        return True  # Pas de filtre = tout accepter

    normalized = _normalize_title(title)
    for cible in titre_cibles:
        cible_upper = cible.strip().upper()
        # Match exact ou contenu
        if cible_upper in normalized or normalized in cible_upper:
            return True
        # Match aussi le titre non-normalisé
        if cible_upper in title.upper():
            return True
    return False


def _contact_completeness(contact: dict) -> dict:
    """Évalue la complétude d'un contact et retourne les champs manquants."""
    required = ["nom", "email", "titre", "entreprise"]
    missing = [f for f in required if not contact.get(f)]
    optional = ["linkedin", "telephone"]
    missing_optional = [f for f in optional if not contact.get(f)]

    return {
        "complet": len(missing) == 0,
        "champs_manquants": missing,
        "champs_optionnels_manquants": missing_optional,
        "score_completude": (len(required) - len(missing)) / len(required) * 100,
    }


# ============================================================
# Client API Fullenrich
# ============================================================

FULLENRICH_BASE_URL = "https://app.fullenrich.com"
FULLENRICH_BATCH_SIZE = 100
FULLENRICH_POLL_INTERVAL = 10  # secondes
FULLENRICH_POLL_TIMEOUT = 120  # secondes
FULLENRICH_MAX_RETRIES = 3


def _fullenrich_headers() -> dict:
    """Headers d'authentification Fullenrich."""
    api_key = os.environ.get("FULLENRICH_API_KEY", "")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _can_enrich_contact(contact: dict) -> bool:
    """Vérifie qu'un contact a les champs requis pour Fullenrich."""
    has_name = bool(contact.get("prenom") or contact.get("nom"))
    has_company = bool(contact.get("domaine") or contact.get("entreprise"))
    return has_name and has_company


def _build_fullenrich_payload(contacts: list[dict]) -> list[dict]:
    """Convertit les contacts en format Fullenrich API."""
    payload = []
    for c in contacts:
        # Séparer nom/prénom si seul 'nom' est fourni
        prenom = c.get("prenom", "")
        nom_complet = c.get("nom", "")
        if not prenom and " " in nom_complet:
            parts = nom_complet.split(" ", 1)
            prenom = parts[0]
            nom_famille = parts[1]
        else:
            nom_famille = nom_complet

        entry = {
            "firstname": prenom,
            "lastname": nom_famille,
        }
        if c.get("domaine"):
            entry["domain"] = c["domaine"]
        if c.get("entreprise"):
            entry["company_name"] = c["entreprise"]
        if c.get("linkedin"):
            entry["linkedin_url"] = c["linkedin"]

        payload.append(entry)
    return payload


def _start_fullenrich_enrichment(contacts_payload: list[dict]) -> str | None:
    """Lance un enrichissement bulk via POST /api/v1/contact/enrich/bulk.
    Retourne l'enrichment_id ou None en cas d'erreur."""
    if _requests is None:
        logger.error("pip install requests requis pour Fullenrich")
        return None

    url = f"{FULLENRICH_BASE_URL}/api/v1/contact/enrich/bulk"
    for attempt in range(FULLENRICH_MAX_RETRIES):
        try:
            resp = _requests.post(
                url,
                headers=_fullenrich_headers(),
                json={"contacts": contacts_payload},
                timeout=30,
            )
            if resp.status_code == 429:
                delay = 2 ** (attempt + 1)
                logger.warning("Fullenrich rate limit, retry dans %ds", delay)
                time.sleep(delay)
                continue
            resp.raise_for_status()
            data = resp.json()
            return data.get("enrichment_id") or data.get("id")
        except Exception as e:
            logger.error("Fullenrich POST erreur (attempt %d): %s", attempt + 1, e)
            if attempt < FULLENRICH_MAX_RETRIES - 1:
                time.sleep(2 ** (attempt + 1))
    return None


def _poll_fullenrich_results(enrichment_id: str) -> list[dict] | None:
    """Poll GET /bulk/{enrichment_id} jusqu'à complétion ou timeout."""
    if _requests is None:
        return None

    url = f"{FULLENRICH_BASE_URL}/bulk/{enrichment_id}"
    elapsed = 0
    while elapsed < FULLENRICH_POLL_TIMEOUT:
        try:
            resp = _requests.get(url, headers=_fullenrich_headers(), timeout=30)
            resp.raise_for_status()
            data = resp.json()
            status = data.get("status", "")
            if status == "completed":
                return data.get("contacts", data.get("results", []))
            if status == "failed":
                logger.error("Fullenrich enrichment %s failed", enrichment_id)
                return None
        except Exception as e:
            logger.warning("Fullenrich poll erreur: %s", e)
        time.sleep(FULLENRICH_POLL_INTERVAL)
        elapsed += FULLENRICH_POLL_INTERVAL

    logger.warning("Fullenrich timeout après %ds pour %s", FULLENRICH_POLL_TIMEOUT, enrichment_id)
    return None


def _merge_fullenrich_results(contacts: list[dict], results: list[dict]) -> list[dict]:
    """Merge les résultats Fullenrich dans les contacts originaux."""
    # Indexer les résultats par nom+domaine pour matcher
    result_index: dict[str, dict] = {}
    for r in results:
        key = f"{r.get('firstname', '').lower()}_{r.get('lastname', '').lower()}_{r.get('domain', '').lower()}"
        result_index[key] = r

    for contact in contacts:
        prenom = contact.get("prenom", "")
        nom = contact.get("nom", "")
        if not prenom and " " in nom:
            parts = nom.split(" ", 1)
            prenom = parts[0]
            nom_famille = parts[1]
        else:
            nom_famille = nom

        key = f"{prenom.lower()}_{nom_famille.lower()}_{contact.get('domaine', '').lower()}"
        match = result_index.get(key)
        if match:
            email = match.get("email", "")
            if email and _validate_email(email):
                contact["email"] = email
            phone = match.get("phone", "")
            if phone:
                contact["telephone"] = phone
            linkedin = match.get("linkedin_url", "")
            if linkedin and not contact.get("linkedin"):
                contact["linkedin"] = linkedin

    return contacts


def enrich_emails_fullenrich(contacts: list[dict]) -> list[dict]:
    """
    Enrichit les emails via l'API Fullenrich.
    - Ne traite que les contacts sans email et avec les champs requis
    - Batch de 100 max, poll async, timeout 120s
    - Crédits consommés uniquement si email trouvé
    """
    api_key = os.environ.get("FULLENRICH_API_KEY", "")
    if not api_key:
        logger.info("FULLENRICH_API_KEY non définie, enrichissement email ignoré")
        return contacts

    if _requests is None:
        logger.warning("pip install requests requis pour enrichissement Fullenrich")
        return contacts

    # Séparer contacts à enrichir vs déjà OK
    to_enrich = []
    for c in contacts:
        if not _validate_email(c.get("email", "")) and _can_enrich_contact(c):
            to_enrich.append(c)

    if not to_enrich:
        logger.info("Aucun contact à enrichir via Fullenrich")
        return contacts

    logger.info("Enrichissement Fullenrich : %d contacts", len(to_enrich))

    # Traiter par batch de 100
    for i in range(0, len(to_enrich), FULLENRICH_BATCH_SIZE):
        batch = to_enrich[i : i + FULLENRICH_BATCH_SIZE]
        payload = _build_fullenrich_payload(batch)

        enrichment_id = _start_fullenrich_enrichment(payload)
        if enrichment_id is None:
            for c in batch:
                c.setdefault("enrichissement_status", "erreur_api")
            continue

        results = _poll_fullenrich_results(enrichment_id)
        if results is None:
            for c in batch:
                c.setdefault("enrichissement_status", "timeout")
            continue

        _merge_fullenrich_results(batch, results)
        for c in batch:
            if _validate_email(c.get("email", "")):
                c["enrichissement_status"] = "ok"
            else:
                c["enrichissement_status"] = "pas_de_resultat"

    return contacts


def load_contacts_from_json(filepath: str) -> list[dict]:
    """
    Charge des contacts pré-enrichis depuis un JSON.
    Format attendu : liste de dicts avec nom, email, titre, entreprise, domaine.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Fichier introuvable : {filepath}")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise ValueError(f"Format invalide : attendu une liste, reçu {type(data).__name__}")

    contacts = []
    for item in data:
        if not isinstance(item, dict):
            continue

        email = (item.get("email") or "").strip()
        contacts.append({
            "nom": str(item.get("nom") or item.get("name") or item.get("full_name") or "").strip(),
            "prenom": str(item.get("prenom") or item.get("first_name") or "").strip(),
            "email": email if _validate_email(email) else "",
            "titre": str(item.get("titre") or item.get("title") or item.get("job_title") or "").strip(),
            "entreprise": str(item.get("entreprise") or item.get("company") or item.get("organization") or "").strip(),
            "domaine": str(item.get("domaine") or item.get("domain") or "").strip(),
            "linkedin": str(item.get("linkedin") or item.get("linkedin_url") or "").strip(),
            "telephone": str(item.get("telephone") or item.get("phone") or "").strip(),
        })

    return contacts


def merge_clay_results(companies: list[dict], clay_contacts: list[dict]) -> list[dict]:
    """
    Fusionne les résultats Clay avec les données entreprises.
    Les contacts Clay arrivent avec le domaine de l'entreprise.
    """
    company_by_domain = {c["domaine"]: c for c in companies}

    merged = []
    for contact in clay_contacts:
        domain = contact.get("domaine", "")
        company = company_by_domain.get(domain, {})

        # Enrichir le contact avec les données entreprise
        contact["entreprise"] = contact.get("entreprise") or company.get("nom", "")
        contact["secteur_entreprise"] = company.get("secteur", "")
        contact["taille_entreprise"] = company.get("taille")
        contact["scoring_entreprise"] = company.get("scoring", {})

        merged.append(contact)

    return merged


def enrich(
    contacts_path: str | None = None,
    companies_path: str | None = None,
) -> dict:
    """
    Point d'entrée. Filtre, valide, et trie les contacts enrichis.
    """
    config = load_config()
    DATA_DIR.mkdir(exist_ok=True)

    # Charger les entreprises qualifiées
    if companies_path is None:
        companies_path = str(DATA_DIR / "boites_qualifiees.json")

    companies = []
    comp_path = Path(companies_path)
    if comp_path.exists():
        with open(comp_path, "r", encoding="utf-8") as f:
            companies = json.load(f)

    # Charger les contacts
    if contacts_path is None:
        contacts_path = str(DATA_DIR / "contacts_clay.json")

    c_path = Path(contacts_path)
    if not c_path.exists():
        return {
            "status": "waiting_for_contacts",
            "message": (
                f"Fichier {contacts_path} introuvable. "
                "Utilisez Clay MCP pour enrichir les contacts, puis relancez."
            ),
            "entreprises_qualifiees": len(companies),
        }

    raw_contacts = load_contacts_from_json(contacts_path)

    if not raw_contacts:
        return {"status": "empty", "message": "Aucun contact dans le fichier", "total": 0}

    # Merger avec les données entreprises
    contacts = merge_clay_results(companies, raw_contacts)

    # Filtrer par titre
    title_matched = []
    title_rejected = []
    for contact in contacts:
        if _matches_target_titles(contact.get("titre", ""), config):
            title_matched.append(contact)
        else:
            contact["raison_rejet"] = f"titre hors cible: {contact.get('titre', '')}"
            title_rejected.append(contact)

    # Enrichir les emails via Fullenrich pour les contacts sans email
    title_matched = enrich_emails_fullenrich(title_matched)

    # Séparer complets / incomplets
    enriched = []
    incomplete = []
    for contact in title_matched:
        completeness = _contact_completeness(contact)
        contact["completude"] = completeness
        if completeness["complet"]:
            enriched.append(contact)
        else:
            incomplete.append(contact)

    # Trier par score entreprise décroissant
    enriched.sort(
        key=lambda c: c.get("scoring_entreprise", {}).get("score", 0),
        reverse=True,
    )

    # Sauvegarder
    output_path = DATA_DIR / "contacts_enrichis.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)

    if incomplete:
        inc_path = DATA_DIR / "incomplets.json"
        with open(inc_path, "w", encoding="utf-8") as f:
            json.dump(incomplete, f, ensure_ascii=False, indent=2)

    return {
        "status": "ok",
        "total_contacts": len(raw_contacts),
        "titre_ok": len(title_matched),
        "titre_rejetes": len(title_rejected),
        "complets": len(enriched),
        "incomplets": len(incomplete),
        "output": str(output_path),
    }


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    contacts_p = args[0] if len(args) > 0 else None
    companies_p = args[1] if len(args) > 1 else None
    result = enrich(contacts_p, companies_p)
    print(json.dumps(result, ensure_ascii=False, indent=2))
