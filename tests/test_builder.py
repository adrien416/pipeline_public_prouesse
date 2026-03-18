"""Tests pour builder.py — construction de la liste de prospects."""

import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

# Ajouter le dossier scripts au path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from builder import (
    _normalize_domain,
    _is_excluded,
    load_from_csv,
    load_from_json,
    deduplicate,
    build,
    load_config,
    CONFIG_PATH,
    DATA_DIR,
)


# ============================================================
# Tests _normalize_domain
# ============================================================

class TestNormalizeDomain:
    def test_simple_domain(self):
        assert _normalize_domain("example.com") == "example.com"

    def test_with_https(self):
        assert _normalize_domain("https://example.com") == "example.com"

    def test_with_http(self):
        assert _normalize_domain("http://example.com") == "example.com"

    def test_with_www(self):
        assert _normalize_domain("www.example.com") == "example.com"

    def test_with_full_url(self):
        assert _normalize_domain("https://www.example.com/path/page") == "example.com"

    def test_with_port(self):
        assert _normalize_domain("example.com:8080") == "example.com"

    def test_uppercase(self):
        assert _normalize_domain("EXAMPLE.COM") == "example.com"

    def test_whitespace(self):
        assert _normalize_domain("  example.com  ") == "example.com"

    def test_empty_string(self):
        assert _normalize_domain("") is None

    def test_only_whitespace(self):
        assert _normalize_domain("   ") is None

    def test_no_dot(self):
        assert _normalize_domain("localhost") is None

    def test_too_short(self):
        assert _normalize_domain("a.b") is None

    def test_trailing_slash(self):
        assert _normalize_domain("example.com/") == "example.com"

    def test_subdomain(self):
        assert _normalize_domain("https://www.app.example.com/page") == "app.example.com"


# ============================================================
# Tests _is_excluded
# ============================================================

class TestIsExcluded:
    @pytest.fixture
    def config(self):
        return {
            "secteurs_exclus": ["casino", "tabac"],
            "pays": ["France"],
            "taille_min": 10,
            "taille_max": 500,
        }

    def test_valid_company(self, config):
        company = {"secteur": "fintech", "pays": "France", "taille": 50}
        assert _is_excluded(company, config) is None

    def test_excluded_sector(self, config):
        company = {"secteur": "Casino en ligne", "pays": "France", "taille": 50}
        result = _is_excluded(company, config)
        assert result is not None
        assert "casino" in result

    def test_excluded_sector_case_insensitive(self, config):
        company = {"secteur": "TABAC", "pays": "France", "taille": 50}
        assert _is_excluded(company, config) is not None

    def test_wrong_country(self, config):
        company = {"secteur": "fintech", "pays": "Allemagne", "taille": 50}
        result = _is_excluded(company, config)
        assert result is not None
        assert "pays" in result

    def test_too_small(self, config):
        company = {"secteur": "fintech", "pays": "France", "taille": 5}
        result = _is_excluded(company, config)
        assert result is not None
        assert "petite" in result

    def test_too_large(self, config):
        company = {"secteur": "fintech", "pays": "France", "taille": 1000}
        result = _is_excluded(company, config)
        assert result is not None
        assert "grande" in result

    def test_missing_country_passes(self, config):
        """Pays non renseigné = pas d'exclusion (donnée manquante)."""
        company = {"secteur": "fintech", "pays": "", "taille": 50}
        assert _is_excluded(company, config) is None

    def test_missing_taille_passes(self, config):
        """Taille non renseignée = pas d'exclusion."""
        company = {"secteur": "fintech", "pays": "France", "taille": None}
        assert _is_excluded(company, config) is None

    def test_empty_config(self):
        """Config sans filtres = tout passe."""
        company = {"secteur": "casino", "pays": "Japon", "taille": 10000}
        assert _is_excluded(company, {}) is None

    def test_boundary_taille_min(self, config):
        """Taille exactement au minimum = OK."""
        company = {"secteur": "fintech", "pays": "France", "taille": 10}
        assert _is_excluded(company, config) is None

    def test_boundary_taille_max(self, config):
        """Taille exactement au maximum = OK."""
        company = {"secteur": "fintech", "pays": "France", "taille": 500}
        assert _is_excluded(company, config) is None


# ============================================================
# Tests load_from_csv
# ============================================================

class TestLoadFromCSV:
    def test_standard_csv(self, tmp_path):
        csv_content = "domaine,nom,secteur,taille,pays\nexample.com,Example,fintech,50,France\n"
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content, encoding="utf-8")

        result = load_from_csv(str(csv_file))
        assert len(result) == 1
        assert result[0]["domaine"] == "example.com"
        assert result[0]["nom"] == "Example"
        assert result[0]["taille"] == 50

    def test_alternative_column_names(self, tmp_path):
        csv_content = "domain,company,industry,employees,country\ntest.com,Test,tech,100,France\n"
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content, encoding="utf-8")

        result = load_from_csv(str(csv_file))
        assert len(result) == 1
        assert result[0]["domaine"] == "test.com"

    def test_missing_domain_column_raises(self, tmp_path):
        csv_content = "nom,secteur\nTest,fintech\n"
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content, encoding="utf-8")

        with pytest.raises(ValueError, match="Colonne domaine introuvable"):
            load_from_csv(str(csv_file))

    def test_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            load_from_csv("/nonexistent/file.csv")

    def test_skips_invalid_domains(self, tmp_path):
        csv_content = "domaine,nom\nexample.com,OK\n,Empty\nnotadomain,Bad\ngood.io,Also OK\n"
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content, encoding="utf-8")

        result = load_from_csv(str(csv_file))
        assert len(result) == 2
        assert result[0]["domaine"] == "example.com"
        assert result[1]["domaine"] == "good.io"

    def test_taille_range_parsing(self, tmp_path):
        csv_content = "domaine,taille\nexample.com,50-100\n"
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content, encoding="utf-8")

        result = load_from_csv(str(csv_file))
        assert result[0]["taille"] == 75  # (50+100)//2

    def test_taille_with_comma(self, tmp_path):
        csv_content = "domaine\ttaille\nexample.com\t1,500\n"
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content, encoding="utf-8")

        result = load_from_csv(str(csv_file))
        assert result[0]["taille"] == 1500

    def test_utf8_bom(self, tmp_path):
        csv_content = "domaine,nom\nexample.com,Société Générale\n"
        csv_file = tmp_path / "test.csv"
        csv_file.write_bytes(b"\xef\xbb\xbf" + csv_content.encode("utf-8"))

        result = load_from_csv(str(csv_file))
        assert len(result) == 1
        assert result[0]["nom"] == "Société Générale"

    def test_semicolon_delimiter(self, tmp_path):
        csv_content = "domaine;nom;taille\nexample.com;Test;50\n"
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content, encoding="utf-8")

        result = load_from_csv(str(csv_file))
        assert len(result) == 1


# ============================================================
# Tests load_from_json
# ============================================================

class TestLoadFromJSON:
    def test_standard_json(self, tmp_path):
        data = [{"domaine": "example.com", "nom": "Example", "taille": 50}]
        json_file = tmp_path / "test.json"
        json_file.write_text(json.dumps(data), encoding="utf-8")

        result = load_from_json(str(json_file))
        assert len(result) == 1
        assert result[0]["domaine"] == "example.com"

    def test_alternative_keys(self, tmp_path):
        data = [{"domain": "test.com", "name": "Test", "size": "100"}]
        json_file = tmp_path / "test.json"
        json_file.write_text(json.dumps(data), encoding="utf-8")

        result = load_from_json(str(json_file))
        assert result[0]["domaine"] == "test.com"
        assert result[0]["taille"] == 100

    def test_not_a_list_raises(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text('{"domaine": "test.com"}', encoding="utf-8")

        with pytest.raises(ValueError, match="liste"):
            load_from_json(str(json_file))

    def test_invalid_json_raises(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text("{invalid", encoding="utf-8")

        with pytest.raises(ValueError, match="JSON invalide"):
            load_from_json(str(json_file))

    def test_skips_non_dict_items(self, tmp_path):
        data = [{"domaine": "example.com"}, "not a dict", 42, None]
        json_file = tmp_path / "test.json"
        json_file.write_text(json.dumps(data), encoding="utf-8")

        result = load_from_json(str(json_file))
        assert len(result) == 1

    def test_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            load_from_json("/nonexistent/file.json")

    def test_taille_string_conversion(self, tmp_path):
        data = [{"domaine": "example.com", "taille": "not_a_number"}]
        json_file = tmp_path / "test.json"
        json_file.write_text(json.dumps(data), encoding="utf-8")

        result = load_from_json(str(json_file))
        assert result[0]["taille"] is None


# ============================================================
# Tests deduplicate
# ============================================================

class TestDeduplicate:
    def test_no_duplicates(self):
        companies = [
            {"domaine": "a.com", "nom": "A"},
            {"domaine": "b.com", "nom": "B"},
        ]
        result = deduplicate(companies)
        assert len(result) == 2

    def test_exact_duplicates(self):
        companies = [
            {"domaine": "a.com", "nom": "A"},
            {"domaine": "a.com", "nom": "A"},
        ]
        result = deduplicate(companies)
        assert len(result) == 1

    def test_keeps_most_complete(self):
        companies = [
            {"domaine": "a.com", "nom": "", "secteur": ""},
            {"domaine": "a.com", "nom": "Company A", "secteur": "tech"},
        ]
        result = deduplicate(companies)
        assert len(result) == 1
        assert result[0]["nom"] == "Company A"

    def test_empty_list(self):
        assert deduplicate([]) == []

    def test_preserves_order(self):
        companies = [
            {"domaine": "c.com", "nom": "C"},
            {"domaine": "a.com", "nom": "A"},
            {"domaine": "b.com", "nom": "B"},
        ]
        result = deduplicate(companies)
        assert [c["domaine"] for c in result] == ["c.com", "a.com", "b.com"]


# ============================================================
# Tests build (intégration)
# ============================================================

class TestBuild:
    def test_build_with_csv(self, tmp_path, monkeypatch):
        # Créer un config.yaml temporaire
        config = {
            "mode": "levee_de_fonds",
            "secteurs_exclus": ["casino"],
            "pays": ["France"],
            "taille_min": 10,
            "taille_max": 500,
        }
        config_file = tmp_path / "config.yaml"
        import yaml
        config_file.write_text(yaml.dump(config), encoding="utf-8")

        data_dir = tmp_path / "data"
        data_dir.mkdir()

        # Monkeypatch les paths
        import builder
        monkeypatch.setattr(builder, "CONFIG_PATH", config_file)
        monkeypatch.setattr(builder, "DATA_DIR", data_dir)

        # Créer CSV
        csv_file = tmp_path / "input.csv"
        csv_file.write_text(
            "domaine,nom,secteur,taille,pays\n"
            "good.com,Good Co,fintech,50,France\n"
            "bad.com,Bad Co,casino,100,France\n"
            "small.com,Small Co,tech,5,France\n",
            encoding="utf-8",
        )

        result = build(str(csv_file))
        assert result["status"] == "ok"
        assert result["acceptes"] == 1
        assert result["exclus"] == 2

        # Vérifier le fichier de sortie
        output = json.loads((data_dir / "boites_brutes.json").read_text())
        assert len(output) == 1
        assert output[0]["domaine"] == "good.com"

    def test_build_no_input(self, tmp_path, monkeypatch):
        import builder
        config_file = tmp_path / "config.yaml"
        import yaml
        config_file.write_text(yaml.dump({"mode": "test"}), encoding="utf-8")
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        monkeypatch.setattr(builder, "CONFIG_PATH", config_file)
        monkeypatch.setattr(builder, "DATA_DIR", data_dir)

        result = build(None)
        assert result["status"] == "no_input"
