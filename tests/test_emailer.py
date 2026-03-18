"""Tests pour emailer.py — génération et envoi d'emails."""

import json
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from emailer import (
    _extract_first_name,
    _is_within_sending_window,
    _load_template,
    generate_email_from_template,
    run_email_campaign,
)


# ============================================================
# Tests _extract_first_name
# ============================================================

class TestExtractFirstName:
    def test_full_name(self):
        assert _extract_first_name("Jean Dupont") == "Jean"

    def test_single_name(self):
        assert _extract_first_name("Jean") == "Jean"

    def test_empty(self):
        assert _extract_first_name("") == ""

    def test_lowercase(self):
        assert _extract_first_name("jean dupont") == "Jean"

    def test_multiple_spaces(self):
        assert _extract_first_name("  Jean   Dupont  ") == "Jean"

    def test_hyphenated(self):
        assert _extract_first_name("Jean-Pierre Dupont") == "Jean-pierre"


# ============================================================
# Tests _is_within_sending_window
# ============================================================

class TestIsWithinSendingWindow:
    def test_weekday_in_window(self, monkeypatch):
        config = {"heure_debut_envoi": "09:00", "heure_fin_envoi": "17:30"}
        import emailer
        fake_now = datetime(2026, 3, 17, 10, 0)  # Mardi 10h

        class FakeDatetime(datetime):
            @classmethod
            def now(cls):
                return fake_now

        monkeypatch.setattr(emailer, "datetime", FakeDatetime)
        assert _is_within_sending_window(config) is True

    def test_weekend_blocked(self, monkeypatch):
        config = {"heure_debut_envoi": "09:00", "heure_fin_envoi": "17:30"}
        import emailer
        fake_now = datetime(2026, 3, 14, 10, 0)  # Samedi

        class FakeDatetime(datetime):
            @classmethod
            def now(cls):
                return fake_now

        monkeypatch.setattr(emailer, "datetime", FakeDatetime)
        assert _is_within_sending_window(config) is False

    def test_before_window(self, monkeypatch):
        config = {"heure_debut_envoi": "09:00", "heure_fin_envoi": "17:30"}
        import emailer
        fake_now = datetime(2026, 3, 17, 7, 0)  # Mardi 7h

        class FakeDatetime(datetime):
            @classmethod
            def now(cls):
                return fake_now

        monkeypatch.setattr(emailer, "datetime", FakeDatetime)
        assert _is_within_sending_window(config) is False


# ============================================================
# Tests _load_template
# ============================================================

class TestLoadTemplate:
    def test_existing_template(self, monkeypatch):
        import emailer
        templates_dir = Path(__file__).resolve().parent.parent / "templates"
        monkeypatch.setattr(emailer, "TEMPLATES_DIR", templates_dir)
        template = _load_template("premier_contact.txt")
        assert "$prenom" in template

    def test_missing_template(self, tmp_path, monkeypatch):
        import emailer
        monkeypatch.setattr(emailer, "TEMPLATES_DIR", tmp_path)
        with pytest.raises(FileNotFoundError, match="Template introuvable"):
            _load_template("nonexistent.txt")


# ============================================================
# Tests generate_email_from_template
# ============================================================

class TestGenerateEmailFromTemplate:
    def test_substitution(self):
        template = "Bonjour $prenom, $entreprise est super."
        contact = {"prenom": "Jean", "entreprise": "TestCo", "titre": "CEO"}
        config = {"mode": "levee_de_fonds"}
        result = generate_email_from_template(contact, template, config)
        assert "Jean" in result["corps"]
        assert "TestCo" in result["corps"]
        assert result["sujet"] != ""

    def test_missing_prenom_uses_nom(self):
        template = "Bonjour $prenom"
        contact = {"nom": "Jean Dupont", "entreprise": "Test"}
        config = {"mode": "cession"}
        result = generate_email_from_template(contact, template, config)
        assert "Jean" in result["corps"]

    def test_empty_contact(self):
        template = "Bonjour $prenom de $entreprise"
        contact = {}
        config = {"mode": "levee_de_fonds"}
        result = generate_email_from_template(contact, template, config)
        # Ne doit pas crasher
        assert result["corps"] is not None


# ============================================================
# Tests run_email_campaign (intégration)
# ============================================================

class TestRunEmailCampaign:
    def test_missing_contacts_file(self, tmp_path, monkeypatch):
        import emailer
        import yaml
        monkeypatch.setattr(emailer, "CONFIG_PATH", tmp_path / "config.yaml")
        monkeypatch.setattr(emailer, "DATA_DIR", tmp_path / "data")
        monkeypatch.setattr(emailer, "TEMPLATES_DIR", tmp_path / "templates")
        (tmp_path / "config.yaml").write_text(yaml.dump({"envoi_par_jour": 15}))
        (tmp_path / "data").mkdir()

        result = run_email_campaign()
        assert result["status"] == "error"

    def test_dry_run_generates_without_sending(self, tmp_path, monkeypatch):
        import emailer
        import yaml
        monkeypatch.setattr(emailer, "CONFIG_PATH", tmp_path / "config.yaml")
        monkeypatch.setattr(emailer, "DATA_DIR", tmp_path / "data")
        monkeypatch.setattr(emailer, "TEMPLATES_DIR", tmp_path / "templates")

        (tmp_path / "config.yaml").write_text(yaml.dump({"envoi_par_jour": 5, "mode": "levee_de_fonds"}))
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "premier_contact.txt").write_text("Bonjour $prenom de $entreprise")

        contacts = [
            {"nom": "Jean Dupont", "email": "jean@test.com", "titre": "CEO", "entreprise": "Test"},
        ]
        (data_dir / "contacts_enrichis.json").write_text(json.dumps(contacts))

        result = run_email_campaign(dry_run=True, use_ai=False)
        assert result["status"] == "ok"
        assert result["mode"] == "dry_run"
        assert result["batch_size"] == 1

    def test_respects_daily_limit(self, tmp_path, monkeypatch):
        import emailer
        import yaml
        monkeypatch.setattr(emailer, "CONFIG_PATH", tmp_path / "config.yaml")
        monkeypatch.setattr(emailer, "DATA_DIR", tmp_path / "data")
        monkeypatch.setattr(emailer, "TEMPLATES_DIR", tmp_path / "templates")

        (tmp_path / "config.yaml").write_text(yaml.dump({"envoi_par_jour": 2, "mode": "levee_de_fonds"}))
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "premier_contact.txt").write_text("Hello $prenom")

        contacts = [{"nom": f"Contact {i}", "email": f"c{i}@test.com", "titre": "CEO", "entreprise": "Test"} for i in range(10)]
        (data_dir / "contacts_enrichis.json").write_text(json.dumps(contacts))

        result = run_email_campaign(dry_run=True, use_ai=False)
        assert result["batch_size"] == 2  # Limité à 2
