"""Offline tests for the client-side relevance filter."""

from __future__ import annotations

from typing import Any

from conftest import DELETE, make_study

from trialradar.config import AreaConfig, ConditionSpec
from trialradar.relevance import filter_relevant, is_relevant


def _with_mesh(study: dict[str, Any], *terms: Any) -> dict[str, Any]:
    study["derivedSection"] = {
        "conditionBrowseModule": {
            "meshes": [{"id": f"D{i}", "term": t} for i, t in enumerate(terms)]
        }
    }
    return study


def test_match_on_condition(cfg: AreaConfig) -> None:
    assert is_relevant(make_study(**{"conditionsModule.conditions": ["Multiple Sclerosis"]}), cfg)


def test_phrase_inside_longer_condition(cfg: AreaConfig) -> None:
    for text in ("Relapsing Multiple Sclerosis (RMS)", "multiple sclerosis, relapsing-remitting"):
        assert is_relevant(make_study(**{"conditionsModule.conditions": [text]}), cfg)


def test_match_on_keyword_only(cfg: AreaConfig) -> None:
    study = make_study(
        **{"conditionsModule.conditions": ["Healthy"], "conditionsModule.keywords": ["NMOSD"]}
    )
    assert is_relevant(study, cfg)


def test_match_on_mesh_only(cfg: AreaConfig) -> None:
    study = _with_mesh(
        make_study(**{"conditionsModule.conditions": ["Healthy"]}), "Myasthenia Gravis"
    )
    assert is_relevant(study, cfg)


def test_phrase_boundary_negative(cfg: AreaConfig) -> None:
    assert not is_relevant(make_study(**{"conditionsModule.conditions": ["CIDPX"]}), cfg)
    assert not is_relevant(make_study(**{"conditionsModule.conditions": ["preCIDP"]}), cfg)
    assert is_relevant(make_study(**{"conditionsModule.conditions": ["CIDP"]}), cfg)


def test_case_whitespace_nbsp_insensitive(cfg: AreaConfig) -> None:
    study = make_study(**{"conditionsModule.conditions": ["  MULTIPLE  sclerosis "]})
    assert is_relevant(study, cfg)


def test_bare_abbreviations_no_longer_match(cfg: AreaConfig) -> None:
    for text in ("MS", "MG", "Devic"):
        assert not is_relevant(make_study(**{"conditionsModule.conditions": [text]}), cfg)


def test_title_is_not_used(cfg: AreaConfig) -> None:
    study = make_study(
        **{
            "conditionsModule.conditions": ["Healthy"],
            "identificationModule.briefTitle": "Multiple sclerosis study",
        }
    )
    assert not is_relevant(study, cfg)


def test_non_matching_excluded(cfg: AreaConfig) -> None:
    assert not is_relevant(make_study(**{"conditionsModule.conditions": ["Healthy"]}), cfg)


def test_missing_and_malformed_do_not_raise(cfg: AreaConfig) -> None:
    assert not is_relevant({}, cfg)
    assert not is_relevant({"protocolSection": None}, cfg)
    assert not is_relevant(make_study(**{"conditionsModule": DELETE}), cfg)
    assert not is_relevant(make_study(**{"conditionsModule.conditions": None}), cfg)
    assert not is_relevant(make_study(**{"conditionsModule.conditions": "multiple sclerosis"}), cfg)
    study = make_study(**{"conditionsModule.conditions": [None, 3, {"a": 1}]})
    assert not is_relevant(study, cfg)
    study["derivedSection"] = None
    assert not is_relevant(study, cfg)
    study["derivedSection"] = {"conditionBrowseModule": {"meshes": [None, {"term": None}, 5]}}
    assert not is_relevant(study, cfg)
    study["derivedSection"] = {"conditionBrowseModule": {"meshes": "x"}}
    assert not is_relevant(study, cfg)
    # a valid entry after junk still matches
    study = make_study(**{"conditionsModule.conditions": [None, 3, "CIDP"]})
    assert is_relevant(study, cfg)


def test_synonym_regex_is_escaped(cfg: AreaConfig) -> None:
    other = cfg.model_copy(
        update={"conditions": [ConditionSpec(label="x", synonyms=["a.c", "(foo"])]}
    )
    assert is_relevant(make_study(**{"conditionsModule.conditions": ["A.C"]}), other)
    assert not is_relevant(make_study(**{"conditionsModule.conditions": ["abc"]}), other)
    assert is_relevant(make_study(**{"conditionsModule.conditions": ["x (foo y"]}), other)


def test_filter_relevant_keeps_order_returns_list(cfg: AreaConfig) -> None:
    studies = [
        make_study("NCT00000003", **{"conditionsModule.conditions": ["CIDP"]}),
        make_study("NCT00000002", **{"conditionsModule.conditions": ["Healthy"]}),
        make_study("NCT00000001", **{"conditionsModule.conditions": ["Multiple Sclerosis"]}),
    ]
    out = filter_relevant(iter(studies), cfg)
    assert isinstance(out, list)
    assert [s["protocolSection"]["identificationModule"]["nctId"] for s in out] == [
        "NCT00000003",
        "NCT00000001",
    ]


def test_other_condition_list_filters_accordingly(cfg: AreaConfig) -> None:
    psoriasis = cfg.model_copy(
        update={"conditions": [ConditionSpec(label="Psoriasis", synonyms=["psoriasis"])]}
    )
    ms = make_study("NCT00000001")
    pso = make_study("NCT00000002", **{"conditionsModule.conditions": ["Plaque Psoriasis"]})
    assert filter_relevant([ms, pso], psoriasis) == [pso]
    assert filter_relevant([ms, pso], cfg) == [ms]
