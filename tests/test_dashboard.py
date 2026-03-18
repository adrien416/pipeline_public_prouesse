"""Tests pour dashboard.py — tableau de bord du pipeline."""

import json
import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from dashboard import (
    _load_json_safe,
    _progress_bar,
    _parse_report_date,
    collect_email_stats,
    collect_pipeline_stats,
    collect_template_info,
    estimate_costs,
    collect_all,
)


# ============================================================
# Tests _progress_bar
# ============================================================

class TestProgressBar:
    def test_half_full(self):
        bar = _progress_bar(5, 10, width=10)
        assert "#####-----" in bar
        assert "5/10" in bar

    def test_empty(self):
        bar = _progress_bar(0, 10, width=10)
        assert "----------" in bar
        assert "0/10" in bar

    def test_full(self):
        bar = _progress_bar(10, 10, width=10)
        assert "##########" in bar

    def test_over_capacity(self):
        bar = _progress_bar(15, 10, width=10)
        assert "##########" in bar  # capped at 100%

    def test_zero_total(self):
        bar = _progress_bar(0, 0, width=10)
        assert "----------" in bar


# ============================================================
# Tests _load_json_safe
# ============================================================

class TestLoadJsonSafe:
    def test_valid_json(self, tmp_path):
        f = tmp_path / "test.json"
        f.write_text('[{"a": 1}]')
        assert _load_json_safe(f) == [{"a": 1}]

    def test_missing_file(self, tmp_path):
        assert _load_json_safe(tmp_path / "missing.json") == []

    def test_invalid_json(self, tmp_path):
        f = tmp_path / "bad.json"
        f.write_text("{invalid")
        assert _load_json_safe(f) == []


# ============================================================
# Tests _parse_report_date
# ============================================================

class TestParseReportDate:
    def test_valid_name(self, tmp_path):
        f = tmp_path / "rapport_envoi_20260318_140000.json"
        result = _parse_report_date(f)
        assert result is not None
        assert result.year == 2026
        assert result.month == 3

    def test_invalid_name(self, tmp_path):
        f = tmp_path / "other_file.json"
        assert _parse_report_date(f) is None


# ============================================================
# Tests collect_email_stats
# ============================================================

class TestCollectEmailStats:
    def test_with_reports(self, tmp_path, monkeypatch):
        import dashboard
        monkeypatch.setattr(dashboard, "DATA_DIR", tmp_path)

        # Créer un rapport d'envoi
        today = datetime.now().strftime("%Y%m%d_%H%M%S")
        report = [
            {"nom": "Jean", "email": "j@t.com", "sent": True, "status": "sent"},
            {"nom": "Marie", "email": "m@t.com", "status": "dry_run"},
            {"nom": "Pierre", "email": "p@t.com", "sent": True, "status": "sent"},
        ]
        (tmp_path / f"rapport_envoi_{today}.json").write_text(json.dumps(report))

        stats = collect_email_stats()
        assert stats["total_envoyes"] == 2
        assert stats["total_dry_run"] == 1
        assert stats["envoyes_aujourd_hui"] == 2

    def test_no_reports(self, tmp_path, monkeypatch):
        import dashboard
        monkeypatch.setattr(dashboard, "DATA_DIR", tmp_path)

        stats = collect_email_stats()
        assert stats["total_envoyes"] == 0
        assert stats["par_jour"] == {}

    def test_empty_data_dir(self, tmp_path, monkeypatch):
        import dashboard
        monkeypatch.setattr(dashboard, "DATA_DIR", tmp_path / "nonexistent")

        stats = collect_email_stats()
        assert stats["total_envoyes"] == 0


# ============================================================
# Tests collect_pipeline_stats
# ============================================================

class TestCollectPipelineStats:
    def test_with_data(self, tmp_path, monkeypatch):
        import dashboard
        monkeypatch.setattr(dashboard, "DATA_DIR", tmp_path)

        brutes = [{"domaine": "a.com"}, {"domaine": "b.com"}, {"domaine": "c.com"}]
        qualifiees = [
            {"domaine": "a.com", "scoring": {"score": 8}},
            {"domaine": "b.com", "scoring": {"score": 9}},
        ]
        contacts = [{"nom": "Jean", "email": "j@a.com"}]
        incomplets = [{"nom": "Marie"}]

        (tmp_path / "boites_brutes.json").write_text(json.dumps(brutes))
        (tmp_path / "boites_qualifiees.json").write_text(json.dumps(qualifiees))
        (tmp_path / "contacts_enrichis.json").write_text(json.dumps(contacts))
        (tmp_path / "incomplets.json").write_text(json.dumps(incomplets))

        stats = collect_pipeline_stats()
        assert stats["boites_brutes"] == 3
        assert stats["boites_qualifiees"] == 2
        assert stats["contacts_enrichis"] == 1
        assert stats["contacts_incomplets"] == 1
        assert stats["score_moyen"] == 8.5

    def test_empty_pipeline(self, tmp_path, monkeypatch):
        import dashboard
        monkeypatch.setattr(dashboard, "DATA_DIR", tmp_path)

        stats = collect_pipeline_stats()
        assert stats["boites_brutes"] == 0
        assert stats["score_moyen"] == 0


# ============================================================
# Tests collect_template_info
# ============================================================

class TestCollectTemplateInfo:
    def test_with_templates(self, tmp_path, monkeypatch):
        import dashboard
        monkeypatch.setattr(dashboard, "TEMPLATES_DIR", tmp_path)

        (tmp_path / "premier_contact.txt").write_text("Bonjour $prenom de $entreprise, voici $offre")
        (tmp_path / "relance.txt").write_text("Re: $prenom")

        templates = collect_template_info()
        assert len(templates) == 2

        pc = next(t for t in templates if t["nom"] == "premier_contact.txt")
        assert "prenom" in pc["variables"]
        assert "entreprise" in pc["variables"]
        assert "offre" in pc["variables"]

    def test_no_templates(self, tmp_path, monkeypatch):
        import dashboard
        monkeypatch.setattr(dashboard, "TEMPLATES_DIR", tmp_path / "nonexistent")

        templates = collect_template_info()
        assert templates == []


# ============================================================
# Tests estimate_costs
# ============================================================

class TestEstimateCosts:
    def test_basic_estimation(self):
        config = {
            "limites": {
                "fullenrich_credits_max_par_mois": 500,
                "fullenrich_credits_alerte_seuil": 50,
                "fullenrich_cout_par_credit_eur": 0.058,
                "haiku_max_appels_par_jour": 200,
                "haiku_cout_input_par_mtok_eur": 0.001,
                "haiku_cout_output_par_mtok_eur": 0.005,
                "haiku_tokens_moyens_par_appel": 800,
                "hubspot_emails_max_par_jour": 50,
            }
        }
        pipeline = {"boites_brutes": 100, "contacts_enrichis": 30}
        email_stats = {"total_envoyes": 10, "total_dry_run": 5, "envoyes_aujourd_hui": 3}

        costs = estimate_costs(config, pipeline, email_stats)

        # Fullenrich
        assert costs["fullenrich"]["credits_utilises"] == 30
        assert costs["fullenrich"]["credits_restants"] == 470
        assert costs["fullenrich"]["alerte_active"] is False
        assert costs["fullenrich"]["cout_total_eur"] == 1.74  # 30 * 0.058

        # Haiku
        assert costs["haiku"]["appels_scoring"] == 100
        assert costs["haiku"]["appels_emails"] == 15  # 10 + 5
        assert costs["haiku"]["appels_total"] == 115

        # HubSpot
        assert costs["hubspot"]["envoyes_aujourd_hui"] == 3
        assert costs["hubspot"]["quota_restant"] == 47

        assert costs["cout_total_eur"] > 0

    def test_alert_triggered(self):
        config = {
            "limites": {
                "fullenrich_credits_max_par_mois": 500,
                "fullenrich_credits_alerte_seuil": 50,
                "fullenrich_cout_par_credit_eur": 0.058,
                "hubspot_emails_max_par_jour": 50,
            }
        }
        pipeline = {"boites_brutes": 10, "contacts_enrichis": 460}
        email_stats = {"total_envoyes": 0, "total_dry_run": 0, "envoyes_aujourd_hui": 0}

        costs = estimate_costs(config, pipeline, email_stats)
        assert costs["fullenrich"]["credits_restants"] == 40
        assert costs["fullenrich"]["alerte_active"] is True

    def test_no_limites_config(self):
        config = {}
        pipeline = {"boites_brutes": 5, "contacts_enrichis": 2}
        email_stats = {"total_envoyes": 1, "total_dry_run": 0, "envoyes_aujourd_hui": 0}

        costs = estimate_costs(config, pipeline, email_stats)
        # Defaults should be used, no crash
        assert "fullenrich" in costs
        assert "haiku" in costs
        assert "hubspot" in costs


# ============================================================
# Tests collect_all (intégration)
# ============================================================

class TestCollectAll:
    def test_collects_all_sections(self, tmp_path, monkeypatch):
        import dashboard
        import yaml
        monkeypatch.setattr(dashboard, "DATA_DIR", tmp_path)
        monkeypatch.setattr(dashboard, "TEMPLATES_DIR", tmp_path / "templates")
        monkeypatch.setattr(dashboard, "CONFIG_PATH", tmp_path / "config.yaml")

        config = {
            "mode": "levee_de_fonds",
            "score_minimum": 7,
            "envoi_par_jour": 15,
            "heure_debut_envoi": "09:00",
            "heure_fin_envoi": "17:30",
            "limites": {
                "fullenrich_credits_max_par_mois": 500,
                "fullenrich_credits_alerte_seuil": 50,
                "fullenrich_cout_par_credit_eur": 0.058,
                "hubspot_emails_max_par_jour": 50,
            },
        }
        (tmp_path / "config.yaml").write_text(yaml.dump(config))
        (tmp_path / "templates").mkdir()
        (tmp_path / "templates" / "test.txt").write_text("Bonjour $prenom")

        data = collect_all()
        assert "timestamp" in data
        assert "pipeline" in data
        assert "emails" in data
        assert "tracking" in data
        assert "templates" in data
        assert "couts" in data
        assert data["config"]["mode"] == "levee_de_fonds"
