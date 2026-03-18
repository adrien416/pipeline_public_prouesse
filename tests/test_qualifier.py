"""Tests pour qualifier.py — scoring IA."""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from qualifier import (
    _build_scoring_prompt,
    _parse_score_response,
    qualify,
)


# ============================================================
# Tests _build_scoring_prompt
# ============================================================

class TestBuildScoringPrompt:
    def test_levee_mode(self):
        config = {"mode": "levee_de_fonds", "secteurs_inclus": ["fintech"], "taille_min": 10, "taille_max": 500}
        company = {"domaine": "test.com", "nom": "Test", "secteur": "fintech", "taille": 50, "pays": "France"}
        prompt = _build_scoring_prompt(company, config)
        assert "levée de fonds" in prompt
        assert "test.com" in prompt
        assert "fintech" in prompt

    def test_cession_mode(self):
        config = {"mode": "cession", "secteurs_inclus": [], "taille_min": 10, "taille_max": 500}
        company = {"domaine": "test.com"}
        prompt = _build_scoring_prompt(company, config)
        assert "M&A" in prompt or "cession" in prompt

    def test_missing_company_fields(self):
        config = {"mode": "levee_de_fonds", "secteurs_inclus": []}
        company = {}
        prompt = _build_scoring_prompt(company, config)
        assert "inconnu" in prompt


# ============================================================
# Tests _parse_score_response
# ============================================================

class TestParseScoreResponse:
    def test_valid_json(self):
        raw = '{"score": 8, "raison": "Bon profil", "signaux_positifs": ["A"], "signaux_negatifs": []}'
        result = _parse_score_response(raw)
        assert result["score"] == 8
        assert result["raison"] == "Bon profil"

    def test_json_in_markdown(self):
        raw = '```json\n{"score": 7, "raison": "OK"}\n```'
        result = _parse_score_response(raw)
        assert result["score"] == 7

    def test_json_with_surrounding_text(self):
        raw = 'Voici mon analyse:\n{"score": 6, "raison": "Moyen"}\nFin.'
        result = _parse_score_response(raw)
        assert result["score"] == 6

    def test_completely_invalid(self):
        raw = "This is not JSON at all"
        result = _parse_score_response(raw)
        assert result["score"] == 0
        assert result.get("erreur_parsing") is True

    def test_score_out_of_range(self):
        raw = '{"score": 15, "raison": "Test"}'
        result = _parse_score_response(raw)
        assert result["score"] == 0  # invalide

    def test_score_negative(self):
        raw = '{"score": -1, "raison": "Test"}'
        result = _parse_score_response(raw)
        assert result["score"] == 0

    def test_score_string_type(self):
        raw = '{"score": "huit", "raison": "Test"}'
        result = _parse_score_response(raw)
        assert result["score"] == 0

    def test_empty_response(self):
        result = _parse_score_response("")
        assert result["score"] == 0

    def test_score_float_valid(self):
        raw = '{"score": 7.5, "raison": "Test"}'
        result = _parse_score_response(raw)
        assert result["score"] == 7.5


# ============================================================
# Tests qualify (intégration)
# ============================================================

class TestQualify:
    def _setup_qualifier(self, tmp_path, monkeypatch):
        """Setup commun : mock anthropic comme disponible."""
        import qualifier
        import types
        # Simuler que anthropic est installé
        fake_anthropic = types.ModuleType("anthropic")
        fake_anthropic.RateLimitError = type("RateLimitError", (Exception,), {})
        fake_anthropic.APIError = type("APIError", (Exception,), {})
        monkeypatch.setattr(qualifier, "anthropic", fake_anthropic)
        return qualifier

    def test_missing_api_key(self, tmp_path, monkeypatch):
        qualifier = self._setup_qualifier(tmp_path, monkeypatch)
        monkeypatch.setattr(qualifier, "CONFIG_PATH", tmp_path / "config.yaml")
        monkeypatch.setattr(qualifier, "DATA_DIR", tmp_path / "data")

        import yaml
        (tmp_path / "config.yaml").write_text(yaml.dump({"score_minimum": 7}))

        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        result = qualify()
        assert result["status"] == "error"
        assert "API_KEY" in result["message"]

    def test_missing_input_file(self, tmp_path, monkeypatch):
        qualifier = self._setup_qualifier(tmp_path, monkeypatch)
        import yaml
        monkeypatch.setattr(qualifier, "CONFIG_PATH", tmp_path / "config.yaml")
        monkeypatch.setattr(qualifier, "DATA_DIR", tmp_path / "data")
        (tmp_path / "config.yaml").write_text(yaml.dump({"score_minimum": 7}))
        (tmp_path / "data").mkdir()

        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        result = qualify()
        assert result["status"] == "error"
        assert "introuvable" in result["message"]

    def test_empty_input(self, tmp_path, monkeypatch):
        qualifier = self._setup_qualifier(tmp_path, monkeypatch)
        import yaml
        monkeypatch.setattr(qualifier, "CONFIG_PATH", tmp_path / "config.yaml")
        monkeypatch.setattr(qualifier, "DATA_DIR", tmp_path / "data")
        (tmp_path / "config.yaml").write_text(yaml.dump({"score_minimum": 7}))
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "boites_brutes.json").write_text("[]")

        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        result = qualify()
        assert result["status"] == "empty"
