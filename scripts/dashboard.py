"""
dashboard.py — Tableau de bord du pipeline de prospection.

Usage :
    python scripts/dashboard.py              # Vue complète
    python scripts/dashboard.py --section emails   # Section spécifique
    python scripts/dashboard.py --json       # Export JSON (pour intégration)
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

import yaml

try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.columns import Columns
    from rich.text import Text
    from rich import box
except ImportError:
    Console = None

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
DATA_DIR = ROOT / "data"
TEMPLATES_DIR = ROOT / "templates"


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# ============================================================
# Collecte des données
# ============================================================


def _load_json_safe(path: Path) -> list | dict:
    """Charge un JSON, retourne [] si absent ou invalide."""
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, ValueError):
        return []


def _find_report_files(prefix: str = "rapport_envoi_") -> list[Path]:
    """Trouve tous les rapports d'envoi triés par date."""
    if not DATA_DIR.exists():
        return []
    files = sorted(DATA_DIR.glob(f"{prefix}*.json"), reverse=True)
    return files


def _parse_report_date(filepath: Path) -> datetime | None:
    """Extrait la date d'un nom de fichier rapport_envoi_YYYYMMDD_HHMMSS.json."""
    match = re.search(r"(\d{8})_(\d{6})", filepath.name)
    if match:
        try:
            return datetime.strptime(f"{match.group(1)}_{match.group(2)}", "%Y%m%d_%H%M%S")
        except ValueError:
            pass
    return None


def collect_email_stats() -> dict:
    """Collecte les stats d'envoi d'emails depuis les rapports."""
    reports = _find_report_files()
    today = datetime.now().date()

    stats = {
        "total_envoyes": 0,
        "total_dry_run": 0,
        "envoyes_aujourd_hui": 0,
        "dry_run_aujourd_hui": 0,
        "derniers_rapports": [],
        "par_jour": {},
    }

    for report_path in reports:
        report_date = _parse_report_date(report_path)
        data = _load_json_safe(report_path)
        if not isinstance(data, list):
            continue

        date_key = report_date.strftime("%Y-%m-%d") if report_date else "inconnu"

        sent_count = sum(1 for r in data if r.get("sent"))
        dry_count = sum(1 for r in data if r.get("status") == "dry_run")

        stats["total_envoyes"] += sent_count
        stats["total_dry_run"] += dry_count

        if report_date and report_date.date() == today:
            stats["envoyes_aujourd_hui"] += sent_count
            stats["dry_run_aujourd_hui"] += dry_count

        if date_key not in stats["par_jour"]:
            stats["par_jour"][date_key] = {"envoyes": 0, "dry_run": 0}
        stats["par_jour"][date_key]["envoyes"] += sent_count
        stats["par_jour"][date_key]["dry_run"] += dry_count

        # Garder les 5 derniers rapports
        if len(stats["derniers_rapports"]) < 5:
            stats["derniers_rapports"].append({
                "date": date_key,
                "fichier": report_path.name,
                "envoyes": sent_count,
                "dry_run": dry_count,
                "contacts": len(data),
            })

    return stats


def collect_tracking_stats() -> dict:
    """Collecte les stats de tracking depuis les rapports d'envoi."""
    reports = _find_report_files()

    tracking = {
        "total_envoyes": 0,
        "avec_hubspot_id": 0,
        "erreurs_envoi": 0,
        "hors_fenetre": 0,
        "contacts_par_entreprise": {},
    }

    for report_path in reports:
        data = _load_json_safe(report_path)
        if not isinstance(data, list):
            continue

        for entry in data:
            if entry.get("sent"):
                tracking["total_envoyes"] += 1
            if entry.get("hubspot_contact_id"):
                tracking["avec_hubspot_id"] += 1
            if entry.get("error"):
                tracking["erreurs_envoi"] += 1
            if entry.get("status") == "hors_fenetre":
                tracking["hors_fenetre"] += 1

            entreprise = entry.get("entreprise", "Inconnu")
            if entreprise:
                tracking["contacts_par_entreprise"][entreprise] = (
                    tracking["contacts_par_entreprise"].get(entreprise, 0) + 1
                )

    return tracking


def collect_template_info() -> list[dict]:
    """Liste les templates avec leurs variables."""
    templates = []
    if not TEMPLATES_DIR.exists():
        return templates

    for tpl_path in sorted(TEMPLATES_DIR.glob("*.txt")):
        with open(tpl_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Trouver les variables $xxx
        variables = sorted(set(re.findall(r"\$(\w+)", content)))
        lines = content.strip().split("\n")
        preview = lines[0][:80] if lines else ""

        templates.append({
            "nom": tpl_path.name,
            "variables": variables,
            "lignes": len(lines),
            "preview": preview,
        })

    return templates


def collect_pipeline_stats() -> dict:
    """Stats du pipeline : boites brutes, qualifiées, contacts."""
    brutes = _load_json_safe(DATA_DIR / "boites_brutes.json")
    qualifiees = _load_json_safe(DATA_DIR / "boites_qualifiees.json")
    contacts = _load_json_safe(DATA_DIR / "contacts_enrichis.json")
    incomplets = _load_json_safe(DATA_DIR / "incomplets.json")

    # Scores des entreprises qualifiées
    scores = [c.get("scoring", {}).get("score", 0) for c in qualifiees if isinstance(c, dict)]
    avg_score = sum(scores) / len(scores) if scores else 0

    return {
        "boites_brutes": len(brutes) if isinstance(brutes, list) else 0,
        "boites_qualifiees": len(qualifiees) if isinstance(qualifiees, list) else 0,
        "contacts_enrichis": len(contacts) if isinstance(contacts, list) else 0,
        "contacts_incomplets": len(incomplets) if isinstance(incomplets, list) else 0,
        "score_moyen": round(avg_score, 1),
    }


def estimate_costs(config: dict, pipeline: dict, email_stats: dict) -> dict:
    """Estime les coûts de la campagne."""
    limites = config.get("limites", {})

    # Fullenrich
    fe_cout_credit = limites.get("fullenrich_cout_par_credit_eur", 0.058)
    fe_max_mois = limites.get("fullenrich_credits_max_par_mois", 500)
    fe_alerte = limites.get("fullenrich_credits_alerte_seuil", 50)
    # Estimer crédits utilisés = contacts enrichis (chaque email trouvé = 1 crédit)
    fe_credits_utilises = pipeline.get("contacts_enrichis", 0)
    fe_credits_restants = max(0, fe_max_mois - fe_credits_utilises)
    fe_cout_total = round(fe_credits_utilises * fe_cout_credit, 2)

    # Haiku
    haiku_cout_input = limites.get("haiku_cout_input_par_mtok_eur", 0.001)
    haiku_cout_output = limites.get("haiku_cout_output_par_mtok_eur", 0.005)
    haiku_tokens = limites.get("haiku_tokens_moyens_par_appel", 800)
    haiku_max_jour = limites.get("haiku_max_appels_par_jour", 200)

    # Appels Haiku = scoring + génération emails
    haiku_appels_scoring = pipeline.get("boites_brutes", 0)
    haiku_appels_emails = email_stats.get("total_envoyes", 0) + email_stats.get("total_dry_run", 0)
    haiku_appels_total = haiku_appels_scoring + haiku_appels_emails
    haiku_cout_total = round(
        haiku_appels_total * haiku_tokens * (haiku_cout_input + haiku_cout_output) / 1000, 2
    )

    # HubSpot
    hs_max_jour = limites.get("hubspot_emails_max_par_jour", 50)
    hs_envoyes_jour = email_stats.get("envoyes_aujourd_hui", 0)

    return {
        "fullenrich": {
            "credits_utilises": fe_credits_utilises,
            "credits_restants": fe_credits_restants,
            "credits_max_mois": fe_max_mois,
            "alerte_seuil": fe_alerte,
            "alerte_active": fe_credits_restants < fe_alerte,
            "cout_total_eur": fe_cout_total,
        },
        "haiku": {
            "appels_scoring": haiku_appels_scoring,
            "appels_emails": haiku_appels_emails,
            "appels_total": haiku_appels_total,
            "max_par_jour": haiku_max_jour,
            "cout_total_eur": haiku_cout_total,
        },
        "hubspot": {
            "envoyes_aujourd_hui": hs_envoyes_jour,
            "max_par_jour": hs_max_jour,
            "quota_restant": hs_max_jour - hs_envoyes_jour,
        },
        "cout_total_eur": round(fe_cout_total + haiku_cout_total, 2),
    }


def collect_all() -> dict:
    """Collecte toutes les données du dashboard."""
    config = load_config()
    pipeline = collect_pipeline_stats()
    email_stats = collect_email_stats()
    tracking = collect_tracking_stats()
    templates = collect_template_info()
    costs = estimate_costs(config, pipeline, email_stats)

    return {
        "timestamp": datetime.now().isoformat(),
        "config": {
            "mode": config.get("mode", "levee_de_fonds"),
            "score_minimum": config.get("score_minimum", 7),
            "envoi_par_jour": config.get("envoi_par_jour", 15),
            "heure_debut": config.get("heure_debut_envoi", "09:00"),
            "heure_fin": config.get("heure_fin_envoi", "17:30"),
        },
        "pipeline": pipeline,
        "emails": email_stats,
        "tracking": tracking,
        "templates": templates,
        "couts": costs,
    }


# ============================================================
# Affichage Rich CLI
# ============================================================


def _progress_bar(used: int, total: int, width: int = 20) -> str:
    """Barre de progression ASCII."""
    if total == 0:
        return "[" + "-" * width + "]"
    ratio = min(used / total, 1.0)
    filled = int(ratio * width)
    return "[" + "#" * filled + "-" * (width - filled) + f"] {used}/{total}"


def render_pipeline_panel(data: dict, console: Console) -> None:
    """Affiche le panel pipeline."""
    p = data["pipeline"]
    table = Table(box=box.SIMPLE, show_header=False, padding=(0, 2))
    table.add_column("Etape", style="bold")
    table.add_column("Valeur", justify="right")

    table.add_row("Boites brutes", str(p["boites_brutes"]))
    table.add_row("Qualifiees (score >= {})".format(data["config"]["score_minimum"]),
                  str(p["boites_qualifiees"]))
    table.add_row("Score moyen", str(p["score_moyen"]))
    table.add_row("Contacts enrichis", str(p["contacts_enrichis"]))
    table.add_row("Contacts incomplets", str(p["contacts_incomplets"]))

    console.print(Panel(table, title="Pipeline", border_style="blue"))


def render_emails_panel(data: dict, console: Console) -> None:
    """Affiche le panel emails."""
    e = data["emails"]
    config = data["config"]

    table = Table(box=box.SIMPLE, show_header=False, padding=(0, 2))
    table.add_column("Metrique", style="bold")
    table.add_column("Valeur", justify="right")

    today_bar = _progress_bar(e["envoyes_aujourd_hui"], config["envoi_par_jour"])
    table.add_row("Envoyes aujourd'hui", today_bar)
    table.add_row("Dry run aujourd'hui", str(e["dry_run_aujourd_hui"]))
    table.add_row("Total envoyes (all time)", str(e["total_envoyes"]))
    table.add_row("Total dry run (all time)", str(e["total_dry_run"]))
    table.add_row("Fenetre d'envoi", f"{config['heure_debut']} - {config['heure_fin']}")

    console.print(Panel(table, title="Emails", border_style="green"))

    # Historique par jour (5 derniers)
    if e["par_jour"]:
        hist = Table(box=box.ROUNDED, title="Historique recent")
        hist.add_column("Date")
        hist.add_column("Envoyes", justify="right")
        hist.add_column("Dry run", justify="right")

        for date_key in sorted(e["par_jour"].keys(), reverse=True)[:7]:
            day = e["par_jour"][date_key]
            hist.add_row(date_key, str(day["envoyes"]), str(day["dry_run"]))

        console.print(hist)


def render_tracking_panel(data: dict, console: Console) -> None:
    """Affiche le panel tracking HubSpot."""
    t = data["tracking"]

    table = Table(box=box.SIMPLE, show_header=False, padding=(0, 2))
    table.add_column("Metrique", style="bold")
    table.add_column("Valeur", justify="right")

    table.add_row("Emails envoyes (HubSpot)", str(t["total_envoyes"]))
    table.add_row("Contacts crees dans CRM", str(t["avec_hubspot_id"]))
    table.add_row("Erreurs d'envoi", str(t["erreurs_envoi"]))
    table.add_row("Hors fenetre", str(t["hors_fenetre"]))

    console.print(Panel(table, title="Tracking HubSpot", border_style="magenta"))

    if t["contacts_par_entreprise"]:
        ent_table = Table(box=box.ROUNDED, title="Contacts par entreprise")
        ent_table.add_column("Entreprise")
        ent_table.add_column("Contacts", justify="right")

        sorted_ents = sorted(t["contacts_par_entreprise"].items(), key=lambda x: x[1], reverse=True)
        for ent, count in sorted_ents[:10]:
            ent_table.add_row(ent, str(count))

        console.print(ent_table)


def render_templates_panel(data: dict, console: Console) -> None:
    """Affiche le panel templates."""
    templates = data["templates"]

    if not templates:
        console.print(Panel("[dim]Aucun template dans templates/[/dim]",
                          title="Templates", border_style="yellow"))
        return

    table = Table(box=box.ROUNDED, title="Templates email")
    table.add_column("Fichier")
    table.add_column("Variables")
    table.add_column("Lignes", justify="right")
    table.add_column("Apercu")

    for tpl in templates:
        vars_str = ", ".join(f"${v}" for v in tpl["variables"])
        table.add_row(tpl["nom"], vars_str, str(tpl["lignes"]), tpl["preview"][:50])

    console.print(table)


def render_costs_panel(data: dict, console: Console) -> None:
    """Affiche le panel couts et limites."""
    c = data["couts"]

    # Fullenrich
    fe = c["fullenrich"]
    fe_style = "red bold" if fe["alerte_active"] else "green"
    fe_bar = _progress_bar(fe["credits_utilises"], fe["credits_max_mois"])

    fe_table = Table(box=box.SIMPLE, show_header=False, padding=(0, 2))
    fe_table.add_column("", style="bold")
    fe_table.add_column("", justify="right")
    fe_table.add_row("Credits utilises", fe_bar)
    fe_table.add_row("Credits restants",
                     Text(str(fe["credits_restants"]), style=fe_style))
    fe_table.add_row("Seuil d'alerte", f"< {fe['alerte_seuil']}")
    fe_table.add_row("Cout total", f"{fe['cout_total_eur']} EUR")

    console.print(Panel(fe_table, title="Fullenrich (emails)", border_style="cyan"))

    # Haiku
    h = c["haiku"]
    h_table = Table(box=box.SIMPLE, show_header=False, padding=(0, 2))
    h_table.add_column("", style="bold")
    h_table.add_column("", justify="right")
    h_table.add_row("Appels scoring", str(h["appels_scoring"]))
    h_table.add_row("Appels emails", str(h["appels_emails"]))
    h_table.add_row("Total appels", str(h["appels_total"]))
    h_table.add_row("Max par jour", str(h["max_par_jour"]))
    h_table.add_row("Cout total", f"{h['cout_total_eur']} EUR")

    console.print(Panel(h_table, title="Claude Haiku (IA)", border_style="yellow"))

    # HubSpot quotas
    hs = c["hubspot"]
    hs_bar = _progress_bar(hs["envoyes_aujourd_hui"], hs["max_par_jour"])
    hs_table = Table(box=box.SIMPLE, show_header=False, padding=(0, 2))
    hs_table.add_column("", style="bold")
    hs_table.add_column("", justify="right")
    hs_table.add_row("Emails aujourd'hui", hs_bar)
    hs_table.add_row("Quota restant", str(hs["quota_restant"]))

    console.print(Panel(hs_table, title="HubSpot (CRM)", border_style="magenta"))

    # Total
    console.print(
        Panel(
            f"[bold]Cout total campagne : {c['cout_total_eur']} EUR[/bold]",
            border_style="red",
        )
    )


def render_dashboard(data: dict, section: str | None = None) -> None:
    """Affiche le dashboard complet ou une section."""
    if Console is None:
        print("pip install rich requis pour l'affichage. Utilisez --json pour le mode texte.")
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return

    console = Console()

    mode_label = "Levee de fonds" if data["config"]["mode"] == "levee_de_fonds" else "Cession"
    console.print()
    console.print(
        Panel(
            f"[bold]{mode_label}[/bold] | Score min: {data['config']['score_minimum']} | "
            f"Max emails/jour: {data['config']['envoi_par_jour']}",
            title="Dashboard Prospection",
            border_style="bold white",
        )
    )

    sections = {
        "pipeline": render_pipeline_panel,
        "emails": render_emails_panel,
        "tracking": render_tracking_panel,
        "templates": render_templates_panel,
        "couts": render_costs_panel,
    }

    if section and section in sections:
        sections[section](data, console)
    else:
        for fn in sections.values():
            fn(data, console)

    console.print(f"\n[dim]Genere le {data['timestamp']}[/dim]\n")


# ============================================================
# Point d'entree
# ============================================================


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Dashboard du pipeline de prospection")
    parser.add_argument("--section", choices=["pipeline", "emails", "tracking", "templates", "couts"],
                       help="Afficher une section specifique")
    parser.add_argument("--json", action="store_true", help="Sortie JSON brute")
    args = parser.parse_args()

    data = collect_all()

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        render_dashboard(data, section=args.section)


if __name__ == "__main__":
    main()
