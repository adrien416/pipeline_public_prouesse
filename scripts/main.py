"""
main.py — Orchestrateur du pipeline de prospection outbound.

Usage :
    python scripts/main.py                    # Pipeline complet (dry run)
    python scripts/main.py --step builder     # Étape spécifique
    python scripts/main.py --send             # Envoi réel (attention !)
    python scripts/main.py --input data/my.csv  # Fichier d'entrée custom
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# Charger .env avant tout import de scripts
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

from builder import build
from qualifier import qualify
from enricher import enrich
from emailer import run_email_campaign
from exporter import export_to_sheets, export_to_csv


STEPS = ["builder", "qualifier", "enricher", "emailer", "exporter"]


def _print_step(name: str, result: dict) -> None:
    """Affiche le résultat d'une étape de façon lisible."""
    status = result.get("status", "unknown")
    icon = "OK" if status == "ok" else "!!" if status == "error" else "--"
    print(f"\n[{icon}] {name.upper()}")
    for k, v in result.items():
        if k != "status":
            print(f"     {k}: {v}")


def run_pipeline(
    step: str | None = None,
    input_path: str | None = None,
    dry_run: bool = True,
    export_csv: bool = False,
    sender_email: str = "",
    sender_name: str = "",
) -> dict:
    """
    Exécute le pipeline complet ou une étape spécifique.
    Retourne un rapport global.
    """
    report = {
        "timestamp": datetime.now().isoformat(),
        "mode": "dry_run" if dry_run else "production",
        "steps": {},
    }

    steps_to_run = [step] if step else STEPS

    for s in steps_to_run:
        if s not in STEPS:
            report["steps"][s] = {"status": "error", "message": f"Étape inconnue : {s}"}
            continue

        try:
            if s == "builder":
                result = build(input_path)
            elif s == "qualifier":
                result = qualify()
            elif s == "enricher":
                result = enrich()
            elif s == "emailer":
                result = run_email_campaign(dry_run=dry_run, sender_email=sender_email, sender_name=sender_name)
            elif s == "exporter":
                if export_csv:
                    result = export_to_csv()
                else:
                    result = export_to_sheets()
            else:
                continue

            report["steps"][s] = result
            _print_step(s, result)

            # Arrêter si une étape critique échoue
            if result.get("status") == "error":
                print(f"\n Pipeline arrêté à l'étape '{s}' (erreur)")
                break

            # Arrêter si pas de données à traiter
            if result.get("status") in ("empty", "no_input", "waiting_for_contacts"):
                print(f"\n Pipeline en pause à l'étape '{s}' : {result.get('message', '')}")
                break

        except Exception as e:
            report["steps"][s] = {"status": "error", "message": str(e)}
            _print_step(s, report["steps"][s])
            print(f"\n Pipeline arrêté à l'étape '{s}' (exception)")
            break

    return report


def main():
    parser = argparse.ArgumentParser(description="Pipeline de prospection outbound")
    parser.add_argument("--step", choices=STEPS, help="Exécuter une seule étape")
    parser.add_argument("--input", dest="input_path", help="Fichier CSV/JSON d'entrée")
    parser.add_argument("--send", action="store_true", help="Envoi réel (pas dry run)")
    parser.add_argument("--csv", action="store_true", help="Export CSV au lieu de Google Sheets")
    parser.add_argument("--sender-email", default="", help="Email de l'expéditeur")
    parser.add_argument("--sender-name", default="", help="Nom de l'expéditeur")
    args = parser.parse_args()

    if args.send:
        print("MODE PRODUCTION — les emails seront réellement envoyés !")
        confirm = input("Confirmer ? (oui/non) : ")
        if confirm.lower() not in ("oui", "o", "yes", "y"):
            print("Annulé.")
            sys.exit(0)

    report = run_pipeline(
        step=args.step,
        input_path=args.input_path,
        dry_run=not args.send,
        export_csv=args.csv,
        sender_email=args.sender_email,
        sender_name=args.sender_name,
    )

    # Sauvegarder le rapport
    report_path = ROOT / "data" / f"pipeline_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\nRapport sauvegardé : {report_path}")


if __name__ == "__main__":
    main()
