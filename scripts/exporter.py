"""
exporter.py — Export des résultats vers Google Sheets.

Entrée : data/contacts_enrichis.json (ou tout JSON pipeline)
Sortie  : Google Sheet mise à jour
"""

import json
import os
from datetime import datetime
from pathlib import Path

import yaml

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    gspread = None


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
DATA_DIR = ROOT / "data"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _get_gspread_client():
    """Initialise le client Google Sheets."""
    if gspread is None:
        raise ImportError("pip install gspread google-auth requis")

    creds_path = ROOT / "credentials.json"
    if not creds_path.exists():
        raise FileNotFoundError(
            "credentials.json introuvable à la racine. "
            "Créez un Service Account dans Google Cloud Console et téléchargez le JSON."
        )

    creds = Credentials.from_service_account_file(str(creds_path), scopes=SCOPES)
    return gspread.authorize(creds)


def _flatten_contact(contact: dict) -> dict:
    """Aplatit un contact pour l'export en tableau."""
    scoring = contact.get("scoring_entreprise", {})
    completude = contact.get("completude", {})

    return {
        "Nom": contact.get("nom", ""),
        "Prénom": contact.get("prenom", ""),
        "Email": contact.get("email", ""),
        "Titre": contact.get("titre", ""),
        "Entreprise": contact.get("entreprise", ""),
        "Domaine": contact.get("domaine", ""),
        "Secteur": contact.get("secteur_entreprise", ""),
        "Taille": contact.get("taille_entreprise", ""),
        "LinkedIn": contact.get("linkedin", ""),
        "Téléphone": contact.get("telephone", ""),
        "Score": scoring.get("score", ""),
        "Raison Score": scoring.get("raison", ""),
        "Complétude %": completude.get("score_completude", ""),
        "Champs Manquants": ", ".join(completude.get("champs_manquants", [])),
        "Date Export": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


def export_to_sheets(
    data_path: str | None = None,
    sheet_name: str = "Prospects Pipeline",
    worksheet_name: str | None = None,
) -> dict:
    """
    Exporte les contacts enrichis vers Google Sheets.
    Crée le worksheet s'il n'existe pas, ou le met à jour.
    """
    # Charger les données
    if data_path is None:
        data_path = str(DATA_DIR / "contacts_enrichis.json")

    path = Path(data_path)
    if not path.exists():
        return {"status": "error", "message": f"Fichier introuvable : {data_path}"}

    with open(path, "r", encoding="utf-8") as f:
        contacts = json.load(f)

    if not contacts:
        return {"status": "empty", "message": "Aucun contact à exporter"}

    # Aplatir les données
    rows = [_flatten_contact(c) for c in contacts]
    headers = list(rows[0].keys())

    # Se connecter à Google Sheets
    try:
        client = _get_gspread_client()
    except (ImportError, FileNotFoundError) as e:
        return {"status": "error", "message": str(e)}

    sheet_id = os.environ.get("GOOGLE_SHEETS_ID")
    if not sheet_id:
        return {"status": "error", "message": "GOOGLE_SHEETS_ID non définie dans .env"}

    try:
        spreadsheet = client.open_by_key(sheet_id)
    except gspread.SpreadsheetNotFound:
        return {"status": "error", "message": f"Spreadsheet {sheet_id} introuvable. Vérifiez l'ID et les permissions."}

    # Créer ou récupérer le worksheet
    if worksheet_name is None:
        worksheet_name = f"Export {datetime.now().strftime('%Y-%m-%d')}"

    try:
        worksheet = spreadsheet.worksheet(worksheet_name)
        worksheet.clear()
    except gspread.WorksheetNotFound:
        worksheet = spreadsheet.add_worksheet(
            title=worksheet_name,
            rows=len(rows) + 1,
            cols=len(headers),
        )

    # Écrire les données
    all_values = [headers] + [[row.get(h, "") for h in headers] for row in rows]

    # Google Sheets API limite à 50k cellules par requête
    BATCH_SIZE = 1000
    for i in range(0, len(all_values), BATCH_SIZE):
        batch = all_values[i : i + BATCH_SIZE]
        start_row = i + 1
        end_row = start_row + len(batch) - 1
        end_col = chr(ord("A") + len(headers) - 1)
        cell_range = f"A{start_row}:{end_col}{end_row}"
        worksheet.update(cell_range, batch)

    return {
        "status": "ok",
        "contacts_exportes": len(rows),
        "worksheet": worksheet_name,
        "spreadsheet_url": spreadsheet.url,
    }


def export_to_csv(data_path: str | None = None, output_name: str = "export.csv") -> dict:
    """Fallback : export CSV local si Google Sheets indisponible."""
    import csv

    if data_path is None:
        data_path = str(DATA_DIR / "contacts_enrichis.json")

    path = Path(data_path)
    if not path.exists():
        return {"status": "error", "message": f"Fichier introuvable : {data_path}"}

    with open(path, "r", encoding="utf-8") as f:
        contacts = json.load(f)

    if not contacts:
        return {"status": "empty", "message": "Aucun contact à exporter"}

    rows = [_flatten_contact(c) for c in contacts]
    headers = list(rows[0].keys())

    output_path = DATA_DIR / output_name
    with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)

    return {
        "status": "ok",
        "contacts_exportes": len(rows),
        "output": str(output_path),
    }


if __name__ == "__main__":
    import sys
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")

    if "--csv" in sys.argv:
        result = export_to_csv()
    else:
        result = export_to_sheets()
    print(json.dumps(result, ensure_ascii=False, indent=2))
