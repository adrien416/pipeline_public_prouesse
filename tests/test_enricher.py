"""Tests pour enricher.py — enrichissement des contacts."""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from enricher import (
    _validate_email,
    _normalize_title,
    _matches_target_titles,
    _contact_completeness,
    _can_enrich_contact,
    _build_fullenrich_payload,
    _merge_fullenrich_results,
    enrich_emails_fullenrich,
    load_contacts_from_json,
    merge_clay_results,
    enrich,
)


# ============================================================
# Tests _validate_email
# ============================================================

class TestValidateEmail:
    def test_valid_email(self):
        assert _validate_email("user@example.com") is True

    def test_valid_email_subdomain(self):
        assert _validate_email("user@mail.example.com") is True

    def test_valid_email_plus(self):
        assert _validate_email("user+tag@example.com") is True

    def test_invalid_no_at(self):
        assert _validate_email("userexample.com") is False

    def test_invalid_no_domain(self):
        assert _validate_email("user@") is False

    def test_invalid_no_tld(self):
        assert _validate_email("user@example") is False

    def test_empty_string(self):
        assert _validate_email("") is False

    def test_none(self):
        assert _validate_email(None) is False

    def test_with_spaces(self):
        assert _validate_email("  user@example.com  ") is True

    def test_double_at(self):
        assert _validate_email("user@@example.com") is False


# ============================================================
# Tests _normalize_title
# ============================================================

class TestNormalizeTitle:
    def test_ceo(self):
        assert _normalize_title("Chief Executive Officer") == "CEO"

    def test_dg(self):
        assert _normalize_title("Directeur Général") == "DG"

    def test_founder(self):
        assert _normalize_title("Founder") == "CEO"

    def test_co_founder(self):
        assert _normalize_title("Co-Founder") == "CEO"

    def test_partner(self):
        assert _normalize_title("Partner") == "ASSOCIÉ"

    def test_unknown_title(self):
        assert _normalize_title("Random Title") == "RANDOM TITLE"

    def test_empty(self):
        assert _normalize_title("") == ""

    def test_whitespace(self):
        assert _normalize_title("  CEO  ") == "CEO"


# ============================================================
# Tests _matches_target_titles
# ============================================================

class TestMatchesTargetTitles:
    @pytest.fixture
    def config(self):
        return {"titre_cibles": ["CEO", "DG", "Directeur Général", "Associé"]}

    def test_exact_match(self, config):
        assert _matches_target_titles("CEO", config) is True

    def test_normalized_match(self, config):
        assert _matches_target_titles("Chief Executive Officer", config) is True

    def test_founder_matches_ceo(self, config):
        assert _matches_target_titles("Founder", config) is True

    def test_co_founder_matches(self, config):
        assert _matches_target_titles("Co-Founder", config) is True

    def test_no_match(self, config):
        assert _matches_target_titles("Développeur Junior", config) is False

    def test_empty_title_cibles(self):
        """Pas de filtre = tout passe."""
        assert _matches_target_titles("Random", {"titre_cibles": []}) is True

    def test_partial_match(self, config):
        assert _matches_target_titles("DG Adjoint", config) is True

    def test_case_insensitive(self, config):
        assert _matches_target_titles("ceo", config) is True


# ============================================================
# Tests _contact_completeness
# ============================================================

class TestContactCompleteness:
    def test_complete_contact(self):
        contact = {"nom": "Jean", "email": "j@x.com", "titre": "CEO", "entreprise": "X"}
        result = _contact_completeness(contact)
        assert result["complet"] is True
        assert result["score_completude"] == 100

    def test_missing_email(self):
        contact = {"nom": "Jean", "email": "", "titre": "CEO", "entreprise": "X"}
        result = _contact_completeness(contact)
        assert result["complet"] is False
        assert "email" in result["champs_manquants"]

    def test_all_missing(self):
        result = _contact_completeness({})
        assert result["complet"] is False
        assert result["score_completude"] == 0

    def test_optional_fields_tracked(self):
        contact = {"nom": "Jean", "email": "j@x.com", "titre": "CEO", "entreprise": "X"}
        result = _contact_completeness(contact)
        assert "linkedin" in result["champs_optionnels_manquants"]


# ============================================================
# Tests load_contacts_from_json
# ============================================================

class TestLoadContactsFromJSON:
    def test_standard_format(self, tmp_path):
        data = [{"nom": "Jean Dupont", "email": "jean@test.com", "titre": "CEO", "entreprise": "Test"}]
        f = tmp_path / "contacts.json"
        f.write_text(json.dumps(data))
        result = load_contacts_from_json(str(f))
        assert len(result) == 1
        assert result[0]["email"] == "jean@test.com"

    def test_alternative_keys(self, tmp_path):
        data = [{"name": "John", "title": "CTO", "company": "Test", "domain": "test.com"}]
        f = tmp_path / "contacts.json"
        f.write_text(json.dumps(data))
        result = load_contacts_from_json(str(f))
        assert result[0]["nom"] == "John"
        assert result[0]["domaine"] == "test.com"

    def test_invalid_email_cleared(self, tmp_path):
        data = [{"nom": "Test", "email": "not-an-email"}]
        f = tmp_path / "contacts.json"
        f.write_text(json.dumps(data))
        result = load_contacts_from_json(str(f))
        assert result[0]["email"] == ""

    def test_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            load_contacts_from_json("/nonexistent.json")

    def test_not_a_list(self, tmp_path):
        f = tmp_path / "contacts.json"
        f.write_text('{"nom": "test"}')
        with pytest.raises(ValueError, match="liste"):
            load_contacts_from_json(str(f))


# ============================================================
# Tests merge_clay_results
# ============================================================

class TestMergeClayResults:
    def test_merge_enriches_contacts(self):
        companies = [{"domaine": "test.com", "nom": "Test Co", "secteur": "tech", "scoring": {"score": 8}}]
        contacts = [{"domaine": "test.com", "nom": "Jean", "entreprise": ""}]
        result = merge_clay_results(companies, contacts)
        assert result[0]["entreprise"] == "Test Co"
        assert result[0]["secteur_entreprise"] == "tech"
        assert result[0]["scoring_entreprise"]["score"] == 8

    def test_merge_unknown_domain(self):
        companies = [{"domaine": "other.com", "nom": "Other"}]
        contacts = [{"domaine": "unknown.com", "nom": "Jean", "entreprise": "Unknown"}]
        result = merge_clay_results(companies, contacts)
        assert result[0]["entreprise"] == "Unknown"


# ============================================================
# Tests enrich (intégration)
# ============================================================

class TestEnrich:
    def test_missing_contacts_file(self, tmp_path, monkeypatch):
        import enricher
        import yaml
        monkeypatch.setattr(enricher, "CONFIG_PATH", tmp_path / "config.yaml")
        monkeypatch.setattr(enricher, "DATA_DIR", tmp_path / "data")
        (tmp_path / "config.yaml").write_text(yaml.dump({"titre_cibles": ["CEO"]}))
        (tmp_path / "data").mkdir()

        result = enrich()
        assert result["status"] == "waiting_for_contacts"

    def test_full_enrichment(self, tmp_path, monkeypatch):
        import enricher
        import yaml
        monkeypatch.setattr(enricher, "CONFIG_PATH", tmp_path / "config.yaml")
        monkeypatch.setattr(enricher, "DATA_DIR", tmp_path / "data")
        (tmp_path / "config.yaml").write_text(yaml.dump({"titre_cibles": ["CEO", "DG"]}))

        data_dir = tmp_path / "data"
        data_dir.mkdir()

        companies = [{"domaine": "test.com", "nom": "Test", "secteur": "tech", "scoring": {"score": 9}}]
        (data_dir / "boites_qualifiees.json").write_text(json.dumps(companies))

        contacts = [
            {"nom": "Jean Dupont", "email": "jean@test.com", "titre": "CEO", "entreprise": "", "domaine": "test.com"},
            {"nom": "Marie Dev", "email": "marie@test.com", "titre": "Développeur", "entreprise": "", "domaine": "test.com"},
            {"nom": "Incomplet", "email": "", "titre": "CEO", "entreprise": "", "domaine": "test.com"},
        ]
        (data_dir / "contacts_clay.json").write_text(json.dumps(contacts))

        # Mock Fullenrich pour ne pas appeler l'API
        with patch("enricher.enrich_emails_fullenrich", side_effect=lambda c: c):
            result = enrich()
        assert result["status"] == "ok"
        assert result["complets"] == 1  # Jean (CEO + email OK)
        assert result["titre_rejetes"] == 1  # Marie (Développeur)
        assert result["incomplets"] == 1  # Incomplet (pas d'email)


# ============================================================
# Tests Fullenrich
# ============================================================

class TestCanEnrichContact:
    def test_valid_contact(self):
        assert _can_enrich_contact({"nom": "Jean Dupont", "domaine": "test.com"}) is True

    def test_with_prenom(self):
        assert _can_enrich_contact({"prenom": "Jean", "entreprise": "Test"}) is True

    def test_missing_name(self):
        assert _can_enrich_contact({"domaine": "test.com"}) is False

    def test_missing_company(self):
        assert _can_enrich_contact({"nom": "Jean"}) is False

    def test_empty_fields(self):
        assert _can_enrich_contact({"nom": "", "domaine": ""}) is False


class TestBuildFullenrichPayload:
    def test_basic_payload(self):
        contacts = [{"nom": "Jean Dupont", "prenom": "", "domaine": "test.com", "entreprise": "Test Co"}]
        result = _build_fullenrich_payload(contacts)
        assert len(result) == 1
        assert result[0]["firstname"] == "Jean"
        assert result[0]["lastname"] == "Dupont"
        assert result[0]["domain"] == "test.com"
        assert result[0]["company_name"] == "Test Co"

    def test_with_prenom(self):
        contacts = [{"nom": "Dupont", "prenom": "Jean", "domaine": "test.com"}]
        result = _build_fullenrich_payload(contacts)
        assert result[0]["firstname"] == "Jean"
        assert result[0]["lastname"] == "Dupont"

    def test_with_linkedin(self):
        contacts = [{"nom": "Jean Dupont", "prenom": "", "domaine": "test.com", "linkedin": "https://linkedin.com/in/jean"}]
        result = _build_fullenrich_payload(contacts)
        assert result[0]["linkedin_url"] == "https://linkedin.com/in/jean"


class TestMergeFullenrichResults:
    def test_merge_email(self):
        contacts = [{"nom": "Jean Dupont", "prenom": "", "domaine": "test.com", "email": ""}]
        results = [{"firstname": "Jean", "lastname": "Dupont", "domain": "test.com", "email": "jean@test.com"}]
        merged = _merge_fullenrich_results(contacts, results)
        assert merged[0]["email"] == "jean@test.com"

    def test_merge_phone(self):
        contacts = [{"nom": "Jean Dupont", "prenom": "", "domaine": "test.com", "email": "", "telephone": ""}]
        results = [{"firstname": "Jean", "lastname": "Dupont", "domain": "test.com", "phone": "+33612345678"}]
        merged = _merge_fullenrich_results(contacts, results)
        assert merged[0]["telephone"] == "+33612345678"

    def test_no_match(self):
        contacts = [{"nom": "Jean Dupont", "prenom": "", "domaine": "test.com", "email": ""}]
        results = [{"firstname": "Marie", "lastname": "Martin", "domain": "other.com", "email": "m@other.com"}]
        merged = _merge_fullenrich_results(contacts, results)
        assert merged[0]["email"] == ""

    def test_invalid_email_not_merged(self):
        contacts = [{"nom": "Jean Dupont", "prenom": "", "domaine": "test.com", "email": ""}]
        results = [{"firstname": "Jean", "lastname": "Dupont", "domain": "test.com", "email": "not-valid"}]
        merged = _merge_fullenrich_results(contacts, results)
        assert merged[0]["email"] == ""


class TestEnrichEmailsFullenrich:
    def test_no_api_key(self, monkeypatch):
        monkeypatch.delenv("FULLENRICH_API_KEY", raising=False)
        contacts = [{"nom": "Jean", "domaine": "test.com", "email": ""}]
        result = enrich_emails_fullenrich(contacts)
        assert result == contacts  # unchanged

    def test_contacts_with_emails_skipped(self, monkeypatch):
        monkeypatch.setenv("FULLENRICH_API_KEY", "test-key")
        contacts = [{"nom": "Jean Dupont", "domaine": "test.com", "email": "jean@test.com", "prenom": "Jean"}]
        # All contacts already have emails → no API call
        with patch("enricher._start_fullenrich_enrichment") as mock_start:
            result = enrich_emails_fullenrich(contacts)
            mock_start.assert_not_called()

    def test_successful_enrichment(self, monkeypatch):
        monkeypatch.setenv("FULLENRICH_API_KEY", "test-key")
        contacts = [{"nom": "Jean Dupont", "prenom": "", "domaine": "test.com", "email": "", "entreprise": "Test"}]

        with patch("enricher._start_fullenrich_enrichment", return_value="enr_123"):
            with patch("enricher._poll_fullenrich_results", return_value=[
                {"firstname": "Jean", "lastname": "Dupont", "domain": "test.com", "email": "jean@test.com"}
            ]):
                result = enrich_emails_fullenrich(contacts)
                assert result[0]["email"] == "jean@test.com"
                assert result[0]["enrichissement_status"] == "ok"

    def test_api_failure(self, monkeypatch):
        monkeypatch.setenv("FULLENRICH_API_KEY", "test-key")
        contacts = [{"nom": "Jean Dupont", "prenom": "", "domaine": "test.com", "email": "", "entreprise": "Test"}]

        with patch("enricher._start_fullenrich_enrichment", return_value=None):
            result = enrich_emails_fullenrich(contacts)
            assert result[0]["enrichissement_status"] == "erreur_api"

    def test_poll_timeout(self, monkeypatch):
        monkeypatch.setenv("FULLENRICH_API_KEY", "test-key")
        contacts = [{"nom": "Jean Dupont", "prenom": "", "domaine": "test.com", "email": "", "entreprise": "Test"}]

        with patch("enricher._start_fullenrich_enrichment", return_value="enr_123"):
            with patch("enricher._poll_fullenrich_results", return_value=None):
                result = enrich_emails_fullenrich(contacts)
                assert result[0]["enrichissement_status"] == "timeout"

    def test_batch_splitting(self, monkeypatch):
        monkeypatch.setenv("FULLENRICH_API_KEY", "test-key")
        # 150 contacts → 2 batches (100 + 50)
        contacts = [
            {"nom": f"Contact {i}", "prenom": "", "domaine": f"test{i}.com", "email": "", "entreprise": f"Co {i}"}
            for i in range(150)
        ]
        call_count = {"n": 0}

        def mock_start(payload):
            call_count["n"] += 1
            return f"enr_{call_count['n']}"

        with patch("enricher._start_fullenrich_enrichment", side_effect=mock_start):
            with patch("enricher._poll_fullenrich_results", return_value=[]):
                enrich_emails_fullenrich(contacts)
                assert call_count["n"] == 2  # 2 batches
