"""Tests pour exporter.py — export des résultats."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from exporter import _flatten_contact, export_to_csv


# ============================================================
# Tests _flatten_contact
# ============================================================

class TestFlattenContact:
    def test_complete_contact(self):
        contact = {
            "nom": "Jean Dupont",
            "prenom": "Jean",
            "email": "jean@test.com",
            "titre": "CEO",
            "entreprise": "Test Co",
            "domaine": "test.com",
            "secteur_entreprise": "fintech",
            "taille_entreprise": 50,
            "linkedin": "https://linkedin.com/in/jean",
            "telephone": "+33612345678",
            "scoring_entreprise": {"score": 9, "raison": "Excellent"},
            "completude": {"score_completude": 100, "champs_manquants": []},
        }
        flat = _flatten_contact(contact)
        assert flat["Nom"] == "Jean Dupont"
        assert flat["Score"] == 9
        assert flat["Complétude %"] == 100
        assert "Date Export" in flat

    def test_empty_contact(self):
        flat = _flatten_contact({})
        assert flat["Nom"] == ""
        assert flat["Score"] == ""
        assert flat["Champs Manquants"] == ""

    def test_missing_scoring(self):
        contact = {"nom": "Test", "scoring_entreprise": {}}
        flat = _flatten_contact(contact)
        assert flat["Score"] == ""
        assert flat["Raison Score"] == ""


# ============================================================
# Tests export_to_csv
# ============================================================

class TestExportToCSV:
    def test_export_creates_file(self, tmp_path, monkeypatch):
        import exporter
        import yaml
        monkeypatch.setattr(exporter, "CONFIG_PATH", tmp_path / "config.yaml")
        monkeypatch.setattr(exporter, "DATA_DIR", tmp_path / "data")
        (tmp_path / "config.yaml").write_text(yaml.dump({}))

        data_dir = tmp_path / "data"
        data_dir.mkdir()

        contacts = [
            {
                "nom": "Jean Dupont",
                "prenom": "Jean",
                "email": "jean@test.com",
                "titre": "CEO",
                "entreprise": "Test",
                "domaine": "test.com",
            }
        ]
        (data_dir / "contacts_enrichis.json").write_text(json.dumps(contacts))

        result = export_to_csv()
        assert result["status"] == "ok"
        assert result["contacts_exportes"] == 1
        assert Path(result["output"]).exists()

    def test_export_missing_file(self, tmp_path, monkeypatch):
        import exporter
        monkeypatch.setattr(exporter, "DATA_DIR", tmp_path / "data")
        (tmp_path / "data").mkdir()

        result = export_to_csv()
        assert result["status"] == "error"

    def test_export_empty_contacts(self, tmp_path, monkeypatch):
        import exporter
        monkeypatch.setattr(exporter, "DATA_DIR", tmp_path / "data")
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "contacts_enrichis.json").write_text("[]")

        result = export_to_csv()
        assert result["status"] == "empty"

    def test_csv_content_correct(self, tmp_path, monkeypatch):
        import csv
        import exporter
        import yaml
        monkeypatch.setattr(exporter, "CONFIG_PATH", tmp_path / "config.yaml")
        monkeypatch.setattr(exporter, "DATA_DIR", tmp_path / "data")
        (tmp_path / "config.yaml").write_text(yaml.dump({}))

        data_dir = tmp_path / "data"
        data_dir.mkdir()
        contacts = [
            {"nom": "Jean", "email": "jean@x.com", "titre": "CEO", "entreprise": "X", "domaine": "x.com"},
            {"nom": "Marie", "email": "marie@y.com", "titre": "CTO", "entreprise": "Y", "domaine": "y.com"},
        ]
        (data_dir / "contacts_enrichis.json").write_text(json.dumps(contacts))

        result = export_to_csv()
        assert result["contacts_exportes"] == 2

        # Vérifier le contenu CSV
        with open(result["output"], "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        assert len(rows) == 2
        assert rows[0]["Nom"] == "Jean"
        assert rows[1]["Email"] == "marie@y.com"
