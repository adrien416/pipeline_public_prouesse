"""Tests pour qualifier.py — scoring IA."""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from qualifier import (
    _build_scoring_prompt,
    _extract_json,
    _normalize_signaux_intention,
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

    def test_signaux_intention_levee(self):
        config = {
            "mode": "levee_de_fonds",
            "secteurs_inclus": ["fintech"],
            "signaux_intention": {
                "levee_de_fonds": ["Recrutements exécutifs récents", "Croissance du headcount"],
                "cession": ["Fondateur en fin de carrière"],
            },
        }
        company = {"domaine": "test.com"}
        prompt = _build_scoring_prompt(company, config)
        assert "Recrutements exécutifs récents" in prompt
        assert "Croissance du headcount" in prompt
        assert "Fondateur en fin de carrière" not in prompt

    def test_signaux_intention_cession(self):
        config = {
            "mode": "cession",
            "secteurs_inclus": [],
            "signaux_intention": {
                "levee_de_fonds": ["Croissance du headcount"],
                "cession": ["Fondateur en fin de carrière"],
            },
        }
        company = {"domaine": "test.com"}
        prompt = _build_scoring_prompt(company, config)
        assert "Fondateur en fin de carrière" in prompt
        assert "Croissance du headcount" not in prompt

    def test_enriched_data_in_prompt(self):
        config = {"mode": "levee_de_fonds", "secteurs_inclus": []}
        company = {
            "domaine": "test.com",
            "enriched_headcount_growth": "+25%",
            "enriched_latest_funding": "Série A 5M€",
        }
        prompt = _build_scoring_prompt(company, config)
        assert "Croissance effectifs" in prompt
        assert "+25%" in prompt
        assert "Dernier financement" in prompt
        assert "Série A 5M€" in prompt

    def test_no_enriched_data(self):
        config = {"mode": "levee_de_fonds", "secteurs_inclus": []}
        company = {"domaine": "test.com"}
        prompt = _build_scoring_prompt(company, config)
        assert "Données enrichies" not in prompt

    def test_signaux_intention_in_json_format(self):
        config = {"mode": "levee_de_fonds", "secteurs_inclus": []}
        company = {"domaine": "test.com"}
        prompt = _build_scoring_prompt(company, config)
        assert "signaux_intention" in prompt
        assert "confiance" in prompt


# ============================================================
# Tests _extract_json
# ============================================================

class TestExtractJson:
    def test_clean_json(self):
        result = _extract_json('{"score": 8, "raison": "OK"}')
        assert result["score"] == 8

    def test_json_with_surrounding_text(self):
        result = _extract_json('Voici mon analyse:\n{"score": 7, "raison": "Bon"}\nFin.')
        assert result["score"] == 7

    def test_nested_json(self):
        raw = '{"score": 8, "signaux_intention": [{"signal": "test", "confiance": "forte"}]}'
        result = _extract_json(raw)
        assert result["score"] == 8
        assert len(result["signaux_intention"]) == 1

    def test_json_in_markdown(self):
        raw = '```json\n{"score": 6}\n```'
        result = _extract_json(raw)
        assert result["score"] == 6

    def test_no_json(self):
        result = _extract_json("This is just text")
        assert result is None

    def test_empty_string(self):
        result = _extract_json("")
        assert result is None

    def test_malformed_json(self):
        result = _extract_json('{"score": }')
        assert result is None

    def test_deeply_nested(self):
        raw = '{"a": {"b": {"c": 1}}, "score": 5}'
        result = _extract_json(raw)
        assert result["score"] == 5

    def test_json_with_escaped_quotes(self):
        raw = r'{"score": 8, "raison": "C\'est \"bon\""}'
        # This may or may not parse depending on escaping, but shouldn't crash
        result = _extract_json(raw)
        # Just verify no crash — result may be None if JSON is invalid


# ============================================================
# Tests _normalize_signaux_intention
# ============================================================

class TestNormalizeSignauxIntention:
    def test_dict_format(self):
        raw = [{"signal": "Recrutement CTO", "confiance": "forte", "source": "LinkedIn"}]
        result = _normalize_signaux_intention(raw)
        assert len(result) == 1
        assert result[0]["confiance"] == "forte"

    def test_string_format(self):
        raw = ["Recrutement CTO récent", "Croissance"]
        result = _normalize_signaux_intention(raw)
        assert len(result) == 2
        assert result[0]["signal"] == "Recrutement CTO récent"
        assert result[0]["confiance"] == "faible"
        assert result[0]["source"] == "inférence"

    def test_mixed_format(self):
        raw = [
            "Signal simple",
            {"signal": "Signal riche", "confiance": "moyenne"},
        ]
        result = _normalize_signaux_intention(raw)
        assert len(result) == 2
        assert result[1]["source"] == "inférence"  # default

    def test_empty_list(self):
        assert _normalize_signaux_intention([]) == []

    def test_invalid_items_skipped(self):
        raw = [42, None, {"no_signal_key": "test"}]
        result = _normalize_signaux_intention(raw)
        assert len(result) == 0

    def test_defaults_added(self):
        raw = [{"signal": "Test"}]
        result = _normalize_signaux_intention(raw)
        assert result[0]["confiance"] == "faible"
        assert result[0]["source"] == "inférence"


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

    def test_nested_json_with_signaux(self):
        raw = json.dumps({
            "score": 8,
            "raison": "Bon",
            "signaux_positifs": ["A"],
            "signaux_negatifs": [],
            "signaux_intention": [
                {"signal": "Recrutement CTO", "confiance": "forte", "source": "LinkedIn"},
            ],
        })
        result = _parse_score_response(raw)
        assert result["score"] == 8
        assert len(result["signaux_intention"]) == 1
        assert result["signaux_intention"][0]["confiance"] == "forte"

    def test_signaux_as_strings(self):
        raw = json.dumps({
            "score": 7,
            "raison": "OK",
            "signaux_intention": ["Recrutement CTO", "Croissance"],
        })
        result = _parse_score_response(raw)
        assert len(result["signaux_intention"]) == 2
        assert result["signaux_intention"][0]["confiance"] == "faible"

    def test_no_signaux_intention_backward_compat(self):
        raw = '{"score": 8, "raison": "Bon profil"}'
        result = _parse_score_response(raw)
        assert result["signaux_intention"] == []

    def test_completely_invalid(self):
        raw = "This is not JSON at all"
        result = _parse_score_response(raw)
        assert result["score"] == 0
        assert result.get("erreur_parsing") is True
        assert result["signaux_intention"] == []

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
