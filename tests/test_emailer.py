"""Tests pour emailer.py — génération et envoi d'emails via HubSpot."""

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
    send_via_hubspot,
    _hubspot_upsert_contact,
    _hubspot_create_email_engagement,
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
# Tests HubSpot — _hubspot_upsert_contact
# ============================================================

class TestHubspotUpsertContact:
    def test_create_new_contact(self, monkeypatch):
        monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "test-token")
        contact = {"nom": "Jean Dupont", "email": "jean@test.com", "titre": "CEO", "entreprise": "Test"}

        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"id": 12345}

        with patch("emailer._requests") as mock_req:
            mock_req.post.return_value = mock_resp
            result = _hubspot_upsert_contact(contact)
            assert result == 12345

    def test_update_existing_contact(self, monkeypatch):
        monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "test-token")
        contact = {"nom": "Jean Dupont", "email": "jean@test.com"}

        # Simule conflit 409
        mock_conflict = MagicMock()
        mock_conflict.status_code = 409
        mock_conflict.json.return_value = {"message": "Contact already exists. Existing ID: 67890"}

        mock_update = MagicMock()
        mock_update.status_code = 200

        with patch("emailer._requests") as mock_req:
            mock_req.post.return_value = mock_conflict
            mock_req.patch.return_value = mock_update
            result = _hubspot_upsert_contact(contact)
            assert result == 67890

    def test_no_email_returns_none(self, monkeypatch):
        monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "test-token")
        result = _hubspot_upsert_contact({"nom": "Jean"})
        assert result is None


# ============================================================
# Tests HubSpot — _hubspot_create_email_engagement
# ============================================================

class TestHubspotCreateEmailEngagement:
    def test_successful_creation(self, monkeypatch):
        monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "test-token")

        mock_email_resp = MagicMock()
        mock_email_resp.status_code = 201
        mock_email_resp.json.return_value = {"id": "email_001"}
        mock_email_resp.raise_for_status = MagicMock()

        mock_assoc_resp = MagicMock()
        mock_assoc_resp.status_code = 200

        with patch("emailer._requests") as mock_req:
            mock_req.post.return_value = mock_email_resp
            mock_req.put.return_value = mock_assoc_resp
            result = _hubspot_create_email_engagement(
                contact_id=12345,
                email_content={"sujet": "Test", "corps": "Body"},
                sender_email="adrien@prouesse.vc",
                recipient_email="jean@test.com",
            )
            assert result["sent"] is True
            assert result["message_id"] == "email_001"
            assert result["hubspot_contact_id"] == 12345

    def test_api_error(self, monkeypatch):
        monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "test-token")

        with patch("emailer._requests") as mock_req:
            mock_req.post.side_effect = Exception("API down")
            result = _hubspot_create_email_engagement(
                contact_id=12345,
                email_content={"sujet": "Test", "corps": "Body"},
                sender_email="a@b.com",
                recipient_email="c@d.com",
            )
            assert result["sent"] is False
            assert "error" in result


# ============================================================
# Tests HubSpot — send_via_hubspot
# ============================================================

class TestSendViaHubspot:
    def test_missing_token(self, monkeypatch):
        monkeypatch.delenv("HUBSPOT_ACCESS_TOKEN", raising=False)
        result = send_via_hubspot(
            {"email": "jean@test.com"},
            {"sujet": "Test", "corps": "Body"},
            "a@b.com", "Adrien",
        )
        assert result["sent"] is False
        assert "HUBSPOT_ACCESS_TOKEN" in result["error"]

    def test_missing_email(self, monkeypatch):
        monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "test-token")
        result = send_via_hubspot(
            {"nom": "Jean"},
            {"sujet": "Test", "corps": "Body"},
            "a@b.com", "Adrien",
        )
        assert result["sent"] is False
        assert "Email du contact" in result["error"]

    def test_incomplete_content(self, monkeypatch):
        monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "test-token")
        result = send_via_hubspot(
            {"email": "jean@test.com"},
            {"sujet": "", "corps": "Body"},
            "a@b.com", "Adrien",
        )
        assert result["sent"] is False

    def test_successful_send(self, monkeypatch):
        monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "test-token")
        contact = {"nom": "Jean Dupont", "email": "jean@test.com", "titre": "CEO", "entreprise": "Test"}

        with patch("emailer._hubspot_upsert_contact", return_value=12345):
            with patch("emailer._hubspot_create_email_engagement", return_value={"sent": True, "message_id": "e_001", "hubspot_contact_id": 12345}):
                result = send_via_hubspot(
                    contact,
                    {"sujet": "Test", "corps": "Body"},
                    "adrien@prouesse.vc", "Adrien",
                )
                assert result["sent"] is True

    def test_contact_creation_fails(self, monkeypatch):
        monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "test-token")

        with patch("emailer._hubspot_upsert_contact", return_value=None):
            result = send_via_hubspot(
                {"email": "jean@test.com", "nom": "Jean"},
                {"sujet": "Test", "corps": "Body"},
                "a@b.com", "Adrien",
            )
            assert result["sent"] is False
            assert "contact" in result["error"].lower()


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
