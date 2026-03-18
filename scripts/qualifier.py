"""
qualifier.py — Scoring IA des entreprises avec Claude Haiku.

Entrée : data/boites_brutes.json
Sortie  : data/boites_qualifiees.json
"""

import json
import os
import time
from pathlib import Path

import yaml

try:
    import anthropic
except ImportError:
    anthropic = None


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
DATA_DIR = ROOT / "data"

# Limites de sécurité
MAX_RETRIES = 3
RETRY_DELAY_BASE = 2  # secondes, exponentiel


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _build_scoring_prompt(company: dict, config: dict) -> str:
    """Construit le prompt de scoring pour Haiku."""
    mode = config.get("mode", "levee_de_fonds")
    secteurs = ", ".join(config.get("secteurs_inclus", []))

    if mode == "levee_de_fonds":
        contexte = "Tu es un analyste spécialisé en levée de fonds. Tu évalues si cette entreprise est un bon candidat pour lever des fonds."
    else:
        contexte = "Tu es un analyste M&A. Tu évalues si cette entreprise est un bon candidat pour une cession ou acquisition."

    return f"""{contexte}

Secteurs cibles : {secteurs}
Taille cible : {config.get('taille_min', 10)}-{config.get('taille_max', 500)} employés

Entreprise à évaluer :
- Domaine : {company.get('domaine', 'inconnu')}
- Nom : {company.get('nom', 'inconnu')}
- Secteur : {company.get('secteur', 'non renseigné')}
- Taille : {company.get('taille', 'non renseigné')} employés
- Pays : {company.get('pays', 'non renseigné')}

Réponds UNIQUEMENT avec un JSON valide (pas de markdown, pas de texte avant/après) :
{{
  "score": <entier de 1 à 10>,
  "raison": "<explication courte en 1-2 phrases>",
  "signaux_positifs": ["<signal1>", "<signal2>"],
  "signaux_negatifs": ["<signal1>"]
}}

Critères de scoring :
- 9-10 : correspond parfaitement aux secteurs cibles, bonne taille, marché porteur
- 7-8 : bon profil avec quelques incertitudes
- 5-6 : potentiel mais secteur tangentiel ou données manquantes
- 3-4 : faible potentiel
- 1-2 : hors cible"""


def _parse_score_response(raw: str) -> dict:
    """Parse la réponse JSON de Haiku, avec tolérance aux erreurs."""
    # Nettoyer le markdown si présent
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        # Retirer première et dernière ligne de code block
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError:
        # Tenter d'extraire le JSON du texte
        import re
        match = re.search(r'\{[^{}]*"score"[^{}]*\}', cleaned, re.DOTALL)
        if match:
            try:
                result = json.loads(match.group())
            except json.JSONDecodeError:
                return {"score": 0, "raison": "Réponse IA non parsable", "erreur_parsing": True}
        else:
            return {"score": 0, "raison": "Réponse IA non parsable", "erreur_parsing": True}

    # Valider le score
    score = result.get("score")
    if not isinstance(score, (int, float)) or score < 1 or score > 10:
        result["score"] = 0
        result["raison"] = result.get("raison", "") + " [score invalide]"

    return result


def score_company(client, company: dict, config: dict) -> dict:
    """Score une entreprise via Claude Haiku. Retries avec backoff."""
    prompt = _build_scoring_prompt(company, config)

    for attempt in range(MAX_RETRIES):
        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            raw_text = response.content[0].text
            return _parse_score_response(raw_text)

        except anthropic.RateLimitError:
            delay = RETRY_DELAY_BASE ** (attempt + 1)
            time.sleep(delay)
        except anthropic.APIError as e:
            if attempt == MAX_RETRIES - 1:
                return {"score": 0, "raison": f"Erreur API : {e}", "erreur_api": True}
            time.sleep(RETRY_DELAY_BASE)

    return {"score": 0, "raison": "Max retries atteint", "erreur_api": True}


def qualify(input_path: str | None = None) -> dict:
    """
    Point d'entrée. Score toutes les entreprises et filtre par score_minimum.
    """
    if anthropic is None:
        return {"status": "error", "message": "pip install anthropic requis"}

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {"status": "error", "message": "ANTHROPIC_API_KEY non définie"}

    config = load_config()
    score_minimum = config.get("score_minimum", 7)

    # Charger les données
    if input_path is None:
        input_path = str(DATA_DIR / "boites_brutes.json")

    path = Path(input_path)
    if not path.exists():
        return {"status": "error", "message": f"Fichier introuvable : {input_path}. Lancez builder.py d'abord."}

    with open(path, "r", encoding="utf-8") as f:
        companies = json.load(f)

    if not companies:
        return {"status": "empty", "message": "Aucune entreprise à qualifier", "total": 0}

    client = anthropic.Anthropic(api_key=api_key)

    qualified = []
    rejected = []
    errors = []

    for i, company in enumerate(companies):
        result = score_company(client, company, config)
        company["scoring"] = result

        if result.get("erreur_api") or result.get("erreur_parsing"):
            errors.append(company)
        elif result["score"] >= score_minimum:
            qualified.append(company)
        else:
            rejected.append(company)

    # Trier par score décroissant
    qualified.sort(key=lambda c: c["scoring"]["score"], reverse=True)

    # Sauvegarder
    DATA_DIR.mkdir(exist_ok=True)
    output_path = DATA_DIR / "boites_qualifiees.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(qualified, f, ensure_ascii=False, indent=2)

    if errors:
        error_path = DATA_DIR / "errors.log"
        with open(error_path, "a", encoding="utf-8") as f:
            for e in errors:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")

    return {
        "status": "ok",
        "total": len(companies),
        "qualifiees": len(qualified),
        "rejetees": len(rejected),
        "erreurs": len(errors),
        "score_minimum": score_minimum,
        "output": str(output_path),
    }


if __name__ == "__main__":
    import sys
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    path = sys.argv[1] if len(sys.argv) > 1 else None
    result = qualify(path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
