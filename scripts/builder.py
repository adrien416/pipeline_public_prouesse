"""
builder.py — Construction de la liste brute de prospects.

Entrée : CSV/JSON de domaines OU recherche manuelle.
Sortie  : data/boites_brutes.json
"""

import json
import csv
import os
import sys
import re
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
DATA_DIR = ROOT / "data"


def load_config() -> dict:
    """Charge config.yaml. Lève une erreur claire si absent ou mal formé."""
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"config.yaml introuvable dans {ROOT}")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    if cfg is None:
        raise ValueError("config.yaml est vide")
    return cfg


def _normalize_domain(raw: str) -> str | None:
    """Nettoie un domaine : retire http(s)://, www., trailing slash, espaces."""
    raw = raw.strip().lower()
    if not raw:
        return None
    # Retirer le protocole
    raw = re.sub(r"^https?://", "", raw)
    # Retirer www.
    raw = re.sub(r"^www\.", "", raw)
    # Retirer le path
    raw = raw.split("/")[0]
    # Retirer le port
    raw = raw.split(":")[0]
    # Validation basique
    if "." not in raw or len(raw) < 4:
        return None
    return raw


def _is_excluded(company: dict, config: dict) -> str | None:
    """Retourne la raison d'exclusion, ou None si OK."""
    secteurs_exclus = [s.lower() for s in config.get("secteurs_exclus", [])]
    secteur = (company.get("secteur") or "").lower()
    for exclu in secteurs_exclus:
        if exclu in secteur:
            return f"secteur exclu: {exclu}"

    pays_ok = [p.lower() for p in config.get("pays", [])]
    pays = (company.get("pays") or "").lower()
    if pays_ok and pays and pays not in pays_ok:
        return f"pays hors cible: {pays}"

    taille = company.get("taille")
    if taille is not None:
        taille_min = config.get("taille_min", 0)
        taille_max = config.get("taille_max", float("inf"))
        if taille < taille_min:
            return f"taille trop petite: {taille} < {taille_min}"
        if taille > taille_max:
            return f"taille trop grande: {taille} > {taille_max}"

    return None


def load_from_csv(filepath: str) -> list[dict]:
    """
    Charge une liste d'entreprises depuis un CSV.
    Colonnes attendues : domaine (obligatoire), nom, secteur, taille, pays
    Colonnes alternatives acceptées : domain, website, url, company_domain
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Fichier CSV introuvable : {filepath}")

    # Détecter l'encodage et le délimiteur
    with open(path, "r", encoding="utf-8-sig") as f:
        sample = f.read(2048)
        f.seek(0)
        sniffer = csv.Sniffer()
        try:
            dialect = sniffer.sniff(sample)
        except csv.Error:
            dialect = csv.excel  # fallback virgule

        reader = csv.DictReader(f, dialect=dialect)
        if reader.fieldnames is None:
            raise ValueError(f"CSV vide ou sans en-têtes : {filepath}")

        # Mapping flexible des colonnes
        headers = {h.strip().lower(): h for h in reader.fieldnames}
        domain_col = None
        for candidate in ["domaine", "domain", "website", "url", "company_domain", "site"]:
            if candidate in headers:
                domain_col = headers[candidate]
                break
        if domain_col is None:
            raise ValueError(
                f"Colonne domaine introuvable. Colonnes trouvées : {list(reader.fieldnames)}. "
                f"Attendu : domaine, domain, website, url, ou company_domain"
            )

        name_col = headers.get("nom") or headers.get("name") or headers.get("company") or headers.get("entreprise")
        secteur_col = headers.get("secteur") or headers.get("sector") or headers.get("industry")
        taille_col = headers.get("taille") or headers.get("size") or headers.get("employees") or headers.get("headcount")
        pays_col = headers.get("pays") or headers.get("country") or headers.get("location")

        companies = []
        for i, row in enumerate(reader, start=2):  # ligne 2 = première data row
            domain = _normalize_domain(row.get(domain_col, ""))
            if domain is None:
                continue

            taille = None
            if taille_col and row.get(taille_col):
                raw_taille = row[taille_col].strip().replace(",", "").replace(" ", "")
                # Gérer les ranges : "50-100" -> prendre le milieu
                if "-" in raw_taille:
                    parts = raw_taille.split("-")
                    try:
                        taille = (int(parts[0]) + int(parts[1])) // 2
                    except (ValueError, IndexError):
                        taille = None
                else:
                    try:
                        taille = int(raw_taille)
                    except ValueError:
                        taille = None

            companies.append({
                "domaine": domain,
                "nom": (row.get(name_col, "") or "").strip() if name_col else "",
                "secteur": (row.get(secteur_col, "") or "").strip() if secteur_col else "",
                "taille": taille,
                "pays": (row.get(pays_col, "") or "").strip() if pays_col else "",
                "source": f"csv:{path.name}:ligne{i}",
            })

    return companies


def load_from_json(filepath: str) -> list[dict]:
    """Charge depuis un JSON (liste de dicts avec au minimum 'domaine' ou 'domain')."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Fichier JSON introuvable : {filepath}")

    with open(path, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON invalide dans {filepath} : {e}")

    if not isinstance(data, list):
        raise ValueError(f"Le JSON doit contenir une liste, pas {type(data).__name__}")

    companies = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        raw_domain = item.get("domaine") or item.get("domain") or item.get("website") or ""
        domain = _normalize_domain(raw_domain)
        if domain is None:
            continue

        taille = item.get("taille") or item.get("size") or item.get("employees")
        if taille is not None:
            try:
                taille = int(taille)
            except (ValueError, TypeError):
                taille = None

        companies.append({
            "domaine": domain,
            "nom": str(item.get("nom") or item.get("name") or "").strip(),
            "secteur": str(item.get("secteur") or item.get("sector") or item.get("industry") or "").strip(),
            "taille": taille,
            "pays": str(item.get("pays") or item.get("country") or "").strip(),
            "source": f"json:{path.name}:index{i}",
        })

    return companies


def deduplicate(companies: list[dict]) -> list[dict]:
    """Déduplique par domaine, garde la première occurrence la plus complète."""
    seen: dict[str, dict] = {}
    for c in companies:
        d = c["domaine"]
        if d not in seen:
            seen[d] = c
        else:
            # Garder l'entrée avec le plus de champs remplis
            existing_score = sum(1 for v in seen[d].values() if v)
            new_score = sum(1 for v in c.values() if v)
            if new_score > existing_score:
                seen[d] = c
    return list(seen.values())


def build(input_path: str | None = None) -> dict:
    """
    Point d'entrée principal.
    Retourne un dict avec les stats et écrit data/boites_brutes.json.
    """
    config = load_config()
    DATA_DIR.mkdir(exist_ok=True)

    # Charger les données
    if input_path is None:
        # Chercher un fichier par défaut dans data/
        candidates = list(DATA_DIR.glob("input.*")) + list(DATA_DIR.glob("prospects.*"))
        if not candidates:
            return {
                "status": "no_input",
                "message": "Aucun fichier d'entrée. Placez un CSV/JSON dans data/ ou passez un chemin.",
                "total": 0,
            }
        input_path = str(candidates[0])

    ext = Path(input_path).suffix.lower()
    if ext == ".csv":
        raw = load_from_csv(input_path)
    elif ext == ".json":
        raw = load_from_json(input_path)
    else:
        raise ValueError(f"Format non supporté : {ext}. Utilisez .csv ou .json")

    if not raw:
        return {"status": "empty", "message": "Aucune entreprise valide dans le fichier", "total": 0}

    # Dédupliquer
    unique = deduplicate(raw)

    # Filtrer les exclusions
    accepted = []
    excluded = []
    for company in unique:
        reason = _is_excluded(company, config)
        if reason:
            company["raison_exclusion"] = reason
            excluded.append(company)
        else:
            accepted.append(company)

    # Sauvegarder
    output_path = DATA_DIR / "boites_brutes.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(accepted, f, ensure_ascii=False, indent=2)

    if excluded:
        excluded_path = DATA_DIR / "exclus.json"
        with open(excluded_path, "w", encoding="utf-8") as f:
            json.dump(excluded, f, ensure_ascii=False, indent=2)

    return {
        "status": "ok",
        "total_brut": len(raw),
        "doublons_retires": len(raw) - len(unique),
        "exclus": len(excluded),
        "acceptes": len(accepted),
        "output": str(output_path),
    }


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else None
    result = build(path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
