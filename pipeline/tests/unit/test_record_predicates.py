"""Offline tests for the fixture recorder's selection predicates and query params."""

from __future__ import annotations

import importlib.util
import sys
from types import ModuleType

from conftest import DELETE, REPO_ROOT, make_study

from trialradar.config import load_config


def _load_script() -> ModuleType:
    path = REPO_ROOT / "pipeline" / "scripts" / "record_fixtures.py"
    spec = importlib.util.spec_from_file_location("record_fixtures", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses resolve annotations via sys.modules
    spec.loader.exec_module(module)
    return module


rf = _load_script()

LABELS = {
    "month_date",
    "multi_phase",
    "no_sites",
    "no_enrollment",
    "terminated_with_reason",
    "many_sites",
}


def _locations(n: int) -> list[dict[str, str]]:
    return [{"facility": f"Site {i}", "country": "United States"} for i in range(n)]


def test_predicates_cover_all_labels() -> None:
    assert set(rf.PREDICATES) == LABELS


def test_month_date() -> None:
    assert rf.month_date(make_study())
    full = make_study(**{"statusModule.startDateStruct": {"date": "2023-05-17", "type": "ACTUAL"}})
    assert not rf.month_date(full)
    assert not rf.month_date(make_study(**{"statusModule.startDateStruct": DELETE}))


def test_multi_phase() -> None:
    assert rf.multi_phase(make_study(**{"designModule.phases": ["PHASE2", "PHASE3"]}))
    assert not rf.multi_phase(make_study())
    assert not rf.multi_phase(make_study(**{"designModule.phases": DELETE}))


def test_no_sites() -> None:
    assert rf.no_sites(make_study(**{"contactsLocationsModule.locations": DELETE}))
    assert not rf.no_sites(make_study())


def test_no_enrollment() -> None:
    assert rf.no_enrollment(make_study(**{"designModule.enrollmentInfo": DELETE}))
    assert not rf.no_enrollment(make_study())


def test_terminated_with_reason() -> None:
    term = make_study(
        **{"statusModule.overallStatus": "TERMINATED", "statusModule.whyStopped": "Low accrual"}
    )
    assert rf.terminated_with_reason(term)
    assert not rf.terminated_with_reason(make_study(**{"statusModule.overallStatus": "TERMINATED"}))
    assert not rf.terminated_with_reason(make_study(**{"statusModule.whyStopped": "x"}))


def test_many_sites() -> None:
    assert rf.many_sites(make_study(**{"contactsLocationsModule.locations": _locations(20)}))
    assert not rf.many_sites(make_study(**{"contactsLocationsModule.locations": _locations(19)}))
    assert not rf.many_sites(make_study())


def test_params_come_from_config() -> None:
    cfg = load_config(REPO_ROOT / "config" / "area.yaml")
    params = rf.build_params(cfg)
    cond = params["query.cond"]
    for spec in cfg.conditions:
        for syn in spec.synonyms:
            assert (f'"{syn}"' if " " in syn else syn) in cond
    assert " OR " in cond
    adv = params["filter.advanced"]
    assert f"AREA[StudyType]{cfg.study_type}" in adv
    for phase in cfg.phases:
        assert f"AREA[Phase]{phase}" in adv
    assert params["pageSize"] == 1000
    assert params["format"] == "json"


def _off_topic(nct: str, **extra: object) -> dict[str, object]:
    return make_study(nct, **{"conditionsModule.conditions": ["Healthy"], **extra})


def test_select_skips_non_relevant_studies() -> None:
    cfg = load_config(REPO_ROOT / "config" / "area.yaml")
    studies = [
        # would satisfy no_sites and no_enrollment, but is off-topic
        _off_topic(
            "NCT00000009",
            **{"contactsLocationsModule.locations": DELETE, "designModule.enrollmentInfo": DELETE},
        ),
        make_study("NCT00000001"),
        make_study("NCT00000001"),  # duplicate
        make_study("NCT00000002", **{"contactsLocationsModule.locations": DELETE}),
    ]
    sel = rf.select_studies(iter(studies), cfg)
    assert sel.fetched == 3
    assert sel.relevant == 2
    assert [rf._nct_id(s) for s in sel.sample] == ["NCT00000001", "NCT00000002"]
    assert rf._nct_id(sel.found["no_sites"]) == "NCT00000002"
    assert "no_enrollment" not in sel.found


def test_select_stops_at_sample_size_and_labels() -> None:
    cfg = load_config(REPO_ROOT / "config" / "area.yaml")
    studies = (make_study(f"NCT{i:08d}") for i in range(1, 100))
    sel = rf.select_studies(studies, cfg, max_studies=30)
    assert len(sel.sample) == rf.SAMPLE_SIZE
    assert sel.relevant == 30  # no labels all found, so it reads up to max_studies
