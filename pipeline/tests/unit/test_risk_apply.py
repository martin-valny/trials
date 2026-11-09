"""risk.json document: who is scored, missing fields, per-trial switch, target roll-up."""

from __future__ import annotations

import math
from datetime import date
from typing import Any

import polars as pl
import pytest
from _risk_synth import single_thread  # noqa: F401
from conftest import REPO_ROOT

from trialradar.config import AreaConfig
from trialradar.explorer.extras import StudyExtras, empty_extras
from trialradar.risk import artefacts
from trialradar.risk.apply import build_risk_doc
from trialradar.tables import SCHEMAS, Tables

FIXTURE = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "risk"
DAY = date(2026, 3, 31)


def _trial(nct: str, status: str, phases: list[str], **kw: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "nct_id": nct,
        "title": nct,
        "phases": phases,
        "overall_status": status,
        "start_date": date(2024, 1, 1),
        "lead_sponsor": "Acme",
        "sponsor_class": "INDUSTRY",
        "masking": "DOUBLE",
        "allocation": "RANDOMIZED",
    }
    row.update(kw)
    return row


def _tables(trials: list[dict[str, Any]], no_drug: tuple[str, ...] = ()) -> Tables:
    ids = [t["nct_id"] for t in trials]
    interv = [
        {"nct_id": n, "type": "BEHAVIORAL" if n in no_drug else "DRUG", "name_normalized": "x"}
        for n in ids
    ]
    e = Tables.empty()
    return Tables(
        pl.DataFrame(trials, schema=SCHEMAS["trial"]),
        e.condition,
        pl.DataFrame(interv, schema=SCHEMAS["intervention"]),
        e.sponsor,
        e.site,
        e.outcome,
    )


@pytest.fixture(scope="module")
def loaded() -> artefacts.Loaded:
    return artefacts.load(FIXTURE)


def _doc(
    loaded: artefacts.Loaded,
    cfg: AreaConfig,
    trials: list[dict[str, Any]],
    figure: dict[str, Any] | None = None,
    extras: dict[str, StudyExtras] | None = None,
    no_drug: tuple[str, ...] = (),
) -> dict[str, Any]:
    return build_risk_doc(_tables(trials, no_drug), extras or {}, cfg, loaded, figure, DAY)


def test_build_risk_doc_scores_running_only(loaded: artefacts.Loaded, cfg: AreaConfig) -> None:
    doc = _doc(
        loaded,
        cfg,
        [
            _trial("NCT00000001", "RECRUITING", ["PHASE2"]),
            _trial("NCT00000002", "COMPLETED", ["PHASE2"]),
            _trial("NCT00000003", "RECRUITING", ["PHASE4"]),
            _trial("NCT00000004", "RECRUITING", ["PHASE2"]),
        ],
        no_drug=("NCT00000004",),
    )
    assert set(doc["trials"]) == {"NCT00000001"}
    assert doc["not_scored"] == {
        "NCT00000003": "phase not 1–3",
        "NCT00000004": "no drug or biologic",
    }
    t = doc["trials"]["NCT00000001"]
    assert 0 <= t["lo"] <= t["p"] <= t["hi"] <= 1
    assert t["basis"] == "phase 2 drug trials"
    assert t["typical"] == 0.2
    assert all(f["dir"] in ("up", "down") for f in t["factors"])
    assert doc["generated_for"] == "2026-03-31"
    assert doc["model"]["shipped"] == loaded.card.shipped
    assert doc["model"]["metrics"]["boosted"]["calibration"]
    assert doc["model"]["typical"]
    assert doc["model"]["per_trial"] is True
    assert doc["model"]["refit_end"] == loaded.card.refit_end
    assert "targets" not in doc


def test_score_running_missing_fields(loaded: artefacts.Loaded, cfg: AreaConfig) -> None:
    bare = _trial(
        "NCT00000009",
        "NOT_YET_RECRUITING",
        ["PHASE2"],
        lead_sponsor=None,
        sponsor_class=None,
        start_date=None,
        masking=None,
        allocation=None,
    )
    doc = _doc(loaded, cfg, [bare])
    t = doc["trials"]["NCT00000009"]
    assert math.isfinite(t["p"]) and math.isfinite(t["lo"]) and math.isfinite(t["hi"])


def test_per_trial_false_omits_trials(loaded: artefacts.Loaded, cfg: AreaConfig) -> None:
    off = cfg.model_copy(update={"risk": cfg.risk.model_copy(update={"per_trial": False})})
    fig = {"rows": [{"id": "fcrn", "marks": [{"n": "NCT00000001", "dz": ["MG"]}]}]}
    doc = _doc(loaded, off, [_trial("NCT00000001", "RECRUITING", ["PHASE2"])], fig)
    assert "trials" not in doc
    assert doc["model"]["per_trial"] is False
    assert doc["targets"]["fcrn"]["all"]["n"] == 1


def test_targets_from_figure_marks(loaded: artefacts.Loaded, cfg: AreaConfig) -> None:
    fig = {
        "rows": [
            {
                "id": "fcrn",
                "marks": [
                    {"n": "NCT00000001", "dz": ["MG"]},
                    {"n": "NCT00000002", "dz": []},
                    {"n": "NCT00000002", "dz": []},  # second drug, same trial: counted once
                    {"n": "NCT00000003", "dz": ["MG"]},  # completed: not scored
                ],
            },
            {"id": "empty", "marks": [{"n": "NCT00000003", "dz": ["MG"]}]},
        ]
    }
    doc = _doc(
        loaded,
        cfg,
        [
            _trial("NCT00000001", "RECRUITING", ["PHASE2"]),
            _trial("NCT00000002", "RECRUITING", ["PHASE3"]),
            _trial("NCT00000003", "COMPLETED", ["PHASE2"]),
        ],
        fig,
    )
    row = doc["targets"]["fcrn"]
    assert row["all"]["n"] == 2
    assert row["by_disease"]["MG"]["n"] == 1
    ps = sorted(doc["trials"][n]["p"] for n in ("NCT00000001", "NCT00000002"))
    assert row["all"]["median"] == pytest.approx(sum(ps) / 2, abs=0.001)
    assert row["all"]["typical"] == pytest.approx(0.19, abs=0.001)
    assert row["by_disease"]["MG"]["typical"] == 0.2
    assert "empty" not in doc["targets"]


def test_no_figure_no_targets(loaded: artefacts.Loaded, cfg: AreaConfig) -> None:
    doc = _doc(loaded, cfg, [_trial("NCT00000001", "RECRUITING", ["PHASE2"])], None)
    assert "targets" not in doc


def test_extras_fields_feed_the_features(loaded: artefacts.Loaded, cfg: AreaConfig) -> None:
    ex = {"NCT00000001": empty_extras("NCT00000001")}
    doc = _doc(loaded, cfg, [_trial("NCT00000001", "RECRUITING", ["PHASE2"])], extras=ex)
    assert "NCT00000001" in doc["trials"]


class _Constant:
    """An estimator stub whose P(stopped) is the same for every row."""

    def predict_proba(self, x: Any) -> Any:
        import numpy as np

        return np.column_stack([np.full(len(x), 0.851), np.full(len(x), 0.149)])


def _many_running(n: int = 24) -> list[dict[str, Any]]:
    phases = (["PHASE1"], ["PHASE2"], ["PHASE3"], ["PHASE2", "PHASE3"])
    return [
        _trial(
            f"NCT{i:08d}",
            "RECRUITING",
            phases[i % 4],
            start_date=date(2016 + i % 10, 1, 1),
            sponsor_class="INDUSTRY" if i % 3 else "OTHER",
            masking=("NONE", "DOUBLE", "QUADRUPLE")[i % 3],
        )
        for i in range(1, n + 1)
    ]


def test_varied_estimates_pass_the_degeneracy_guard(
    loaded: artefacts.Loaded, cfg: AreaConfig
) -> None:
    trials = _many_running()
    base = _tables(trials)
    outcomes = pl.DataFrame(
        [
            {"nct_id": t["nct_id"], "kind": "secondary", "measure": f"m{k}"}
            for i, t in enumerate(trials)
            for k in range(i % 12)
        ],
        schema=SCHEMAS["outcome"],
    )
    tables = Tables(
        base.trial, base.condition, base.intervention, base.sponsor, base.site, outcomes
    )
    doc = build_risk_doc(tables, {}, cfg, loaded, None, DAY)
    assert len({t["p"] for t in doc["trials"].values()}) >= 3


def test_degenerate_estimates_raise(loaded: artefacts.Loaded, cfg: AreaConfig) -> None:
    """A shipped main that outputs one value for every running trial must never ship."""
    from dataclasses import replace

    main = replace(loaded.shipped.main, estimator=_Constant())
    flat = replace(loaded, shipped=replace(loaded.shipped, main=main))
    with pytest.raises(ValueError, match="degenerate"):
        _doc(flat, cfg, _many_running())


def _with_names(tables: Tables, names: dict[str, list[tuple[str, str]]]) -> Tables:
    rows = [
        {"nct_id": n, "type": t, "name": nm, "name_normalized": nm.lower()}
        for n, ivs in names.items()
        for t, nm in ivs
    ]
    return Tables(
        tables.trial,
        tables.condition,
        pl.DataFrame(rows, schema=SCHEMAS["intervention"]),
        tables.sponsor,
        tables.site,
        tables.outcome,
    )


def test_drug_name_canonical_in_a_row_else_registry_casing(
    loaded: artefacts.Loaded, cfg: AreaConfig
) -> None:
    """A row trial keeps the figure's canonical drug name, but takes the registry's own casing
    when the registered name spells it with capitals past the first letter (a code name such
    as RO7121932, even inside "RO7121932 IV"); a plain capital ("Rituximab") stays lower-case.
    A trial in no row takes its first experimental drug or biologic as registered."""
    from dataclasses import replace

    ids = ["NCT00000001", "NCT00000002", "NCT00000003", "NCT00000004", "NCT00000005"]
    tables = _with_names(
        _tables([_trial(n, "RECRUITING", ["PHASE2"]) for n in ids]),
        {
            "NCT00000001": [("DRUG", "Rituximab 500 mg"), ("DRUG", "Placebo")],
            "NCT00000002": [("DRUG", "Placebo"), ("BIOLOGICAL", "RO7121932 IV")],
            "NCT00000003": [("DRUG", "Placebo"), ("BIOLOGICAL", "KITE-363")],
            "NCT00000004": [("BEHAVIORAL", "Diary"), ("DRUG", "Ocrelizumab IV")],
            "NCT00000005": [("BIOLOGICAL", "Efgartigimod PH20 (ARGX-113) SC")],
        },
    )
    fig = {
        "rows": [
            {"id": "cd20", "marks": [{"n": "NCT00000001", "dz": [], "drug": "rituximab"}]},
            {"id": "x", "marks": [{"n": "NCT00000002", "dz": [], "drug": "ro7121932"}]},
            {"id": "y", "marks": [{"n": "NCT00000005", "dz": [], "drug": "efgartigimod ph20"}]},
        ]
    }
    extras = {
        "NCT00000003": replace(empty_extras("NCT00000003"), experimental_drugs=("KITE-363",)),
    }
    doc = build_risk_doc(tables, extras, cfg, loaded, fig, DAY)
    drugs = {n: doc["trials"][n]["drug"] for n in ids}
    assert drugs == {
        "NCT00000001": "rituximab",
        "NCT00000002": "RO7121932",
        "NCT00000003": "KITE-363",
        "NCT00000004": "Ocrelizumab IV",
        "NCT00000005": "Efgartigimod PH20",
    }


def test_effectively_finished_running_trials_not_scored(
    loaded: artefacts.Loaded, cfg: AreaConfig
) -> None:
    """Active, not recruiting with an actual primary completion date in the past, or any
    running trial with results posted, is finished in all but status: listed, not scored."""
    from dataclasses import replace

    past, future = date(2025, 6, 1), date(2027, 1, 1)
    trials = [
        _trial(
            "NCT00000001",
            "ACTIVE_NOT_RECRUITING",
            ["PHASE3"],
            primary_completion_date=past,
            primary_completion_date_type="ACTUAL",
        ),
        _trial(
            "NCT00000002",
            "ACTIVE_NOT_RECRUITING",
            ["PHASE3"],
            primary_completion_date=past,
            primary_completion_date_type="ESTIMATED",
        ),
        _trial(
            "NCT00000003",
            "ACTIVE_NOT_RECRUITING",
            ["PHASE3"],
            primary_completion_date=future,
            primary_completion_date_type="ESTIMATED",
        ),
        _trial("NCT00000004", "RECRUITING", ["PHASE2"]),
        _trial(
            "NCT00000005",
            "RECRUITING",
            ["PHASE2"],
            primary_completion_date=past,
            primary_completion_date_type="ACTUAL",
        ),
    ]
    extras = {"NCT00000004": replace(empty_extras("NCT00000004"), has_results=True)}
    doc = _doc(loaded, cfg, trials, extras=extras)
    assert doc["not_scored"] == {
        "NCT00000001": "primary completion reached",
        "NCT00000004": "results posted",
    }
    assert set(doc["trials"]) == {"NCT00000002", "NCT00000003", "NCT00000005"}
