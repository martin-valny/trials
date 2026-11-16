"""Parity check (scripts/check_risk_parity.py), offline: the pure compare and a fake client."""

from __future__ import annotations

import copy
import importlib.util
import json
import math
import sys
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from trialradar.risk.features_v2 import FEATURES_V2

_SPEC = importlib.util.spec_from_file_location(
    "check_risk_parity",
    Path(__file__).resolve().parents[2] / "scripts" / "check_risk_parity.py",
)
assert _SPEC and _SPEC.loader
script = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = script
_SPEC.loader.exec_module(script)

_TRAIN_SPEC = importlib.util.spec_from_file_location(
    "train_stop_risk_v2_for_parity",
    Path(__file__).resolve().parents[2] / "scripts" / "train_stop_risk_v2.py",
)
assert _TRAIN_SPEC and _TRAIN_SPEC.loader
trainer = importlib.util.module_from_spec(_TRAIN_SPEC)
sys.modules[_TRAIN_SPEC.name] = trainer
_TRAIN_SPEC.loader.exec_module(trainer)

STUDIES = Path(__file__).resolve().parents[1] / "fixtures" / "studies" / "sample20.jsonl"
ALIASES = Path(__file__).resolve().parents[3] / "config" / "aliases"


def _frame(rows: list[dict[str, Any]]) -> pl.DataFrame:
    schema = {"nct_id": pl.Utf8, "n_sites": pl.Int64, "age_months": pl.Float64}
    return pl.DataFrame(rows, schema=schema)


def test_parity_compare_counts_mismatches() -> None:
    """Per feature, the share of trials (matched by nct_id, never by position) whose two values
    differ: ints exact, floats within 1e-9, null equal to null, null against a value a
    mismatch; NaN counts as null."""
    aact = _frame(
        [
            {"nct_id": "A", "n_sites": 3, "age_months": 10.0},
            {"nct_id": "B", "n_sites": None, "age_months": 5.0},
            {"nct_id": "C", "n_sites": 2, "age_months": None},
            {"nct_id": "D", "n_sites": 7, "age_months": float("nan")},
            {"nct_id": "only_aact", "n_sites": 1, "age_months": 1.0},
        ]
    )
    live = _frame(
        [
            {"nct_id": "D", "n_sites": 7, "age_months": None},
            {"nct_id": "C", "n_sites": 3, "age_months": 1.0},
            {"nct_id": "B", "n_sites": None, "age_months": 5.0 + 1e-12},
            {"nct_id": "A", "n_sites": 3, "age_months": 10.0 + 1e-6},
        ]
    )
    shares, n = script.compare(aact, live, ("n_sites", "age_months"))
    assert n == 4
    assert shares == {"n_sites": 0.25, "age_months": 0.5}  # n_sites: C; age: A (1e-6), C


def test_parity_compare_ints_are_exact() -> None:
    a = pl.DataFrame({"nct_id": ["A"], "n_sites": [10**12]})
    b = pl.DataFrame({"nct_id": ["A"], "n_sites": [10**12 + 1]})
    assert script.compare(a, b, ("n_sites",)) == ({"n_sites": 1.0}, 1)


def test_parity_compare_without_shared_trials_is_an_error() -> None:
    a = _frame([{"nct_id": "A", "n_sites": 1, "age_months": 1.0}])
    b = _frame([{"nct_id": "B", "n_sites": 1, "age_months": 1.0}])
    with pytest.raises(ValueError, match="no trial"):
        script.compare(a, b, ("n_sites",))


AS_OF = date(2026, 1, 1)


def _running(study: dict[str, Any]) -> dict[str, Any]:
    """A copy of a recorded study that the daily run would score: recruiting, no results."""
    s = copy.deepcopy(study)
    s["hasResults"] = False
    s["protocolSection"]["statusModule"]["overallStatus"] = "RECRUITING"
    return s


class _FakeClient:
    """Answers filter.ids queries from the recorded studies (made running unless `status`
    overrides one); never touches the network."""

    def __init__(self, status: dict[str, str] | None = None) -> None:
        self.studies = {
            s["protocolSection"]["identificationModule"]["nctId"]: _running(s)
            for s in map(json.loads, STUDIES.read_text().splitlines())
        }
        for nct, st in (status or {}).items():
            self.studies[nct]["protocolSection"]["statusModule"]["overallStatus"] = st
        self.queries: list[dict[str, str]] = []

    def iter_query(self, params: dict[str, str]) -> Any:
        self.queries.append(params)
        for nct in params["filter.ids"].split(","):
            if nct in self.studies:
                yield self.studies[nct]


def _live_dates(client: _FakeClient) -> dict[str, date]:
    return {
        n: date.fromisoformat(
            s["protocolSection"]["statusModule"]["lastUpdatePostDateStruct"]["date"]
        )
        for n, s in client.studies.items()
    }


def test_matched_sample_keeps_unchanged_records_only() -> None:
    client = _FakeClient()
    ids = sorted(client.studies)
    live_dates = _live_dates(client)
    # AACT agrees on every other trial; the rest were updated after the snapshot.
    aact_dates: dict[str, date | None] = {
        n: (live_dates[n] if i % 2 == 0 else date(2000, 1, 1)) for i, n in enumerate(ids)
    }
    aact_dates[ids[0]] = None  # no update date in AACT: never a match
    aact_dates["NCT99999999"] = date(2020, 1, 1)  # gone from the live registry
    want = {n for i, n in enumerate(ids) if i % 2 == 0 and i != 0}

    studies, tables, report = script.matched_sample(
        client, aact_dates, n=100, aliases_dir=ALIASES, as_of=AS_OF, seed=0, batch=4
    )
    assert set(tables.trial["nct_id"].to_list()) == want
    assert {s["protocolSection"]["identificationModule"]["nctId"] for s in studies} == want
    assert report == {
        "candidates": len(ids) + 1,
        "fetched": len(ids),
        "unchanged": len(want),
        "live_not_running": 0,
        "live_finished": 0,
        "matched": len(want),
    }
    assert all(len(q["filter.ids"].split(",")) <= 4 for q in client.queries)

    _, few, rep = script.matched_sample(
        client, aact_dates, n=3, aliases_dir=ALIASES, as_of=AS_OF, seed=0, batch=4
    )
    assert few.trial.height == 3 and rep["matched"] == 3
    assert set(few.trial["nct_id"].to_list()) <= want


def test_matched_sample_drops_records_no_longer_running_live() -> None:
    """The registry flips a record whose verification lapsed to UNKNOWN without a new update
    date; the daily run would not score it, so it is left out and counted, not compared.
    Likewise a live record finished in all but status (active, not recruiting with an actual
    primary completion date before as_of)."""
    base = _FakeClient()
    ids = sorted(base.studies)
    unknown, finished = ids[1], ids[2]
    client = _FakeClient(status={unknown: "UNKNOWN", finished: "ACTIVE_NOT_RECRUITING"})
    status = client.studies[finished]["protocolSection"]["statusModule"]
    status["primaryCompletionDateStruct"] = {"date": "2025-06-01", "type": "ACTUAL"}
    aact_dates: dict[str, date | None] = dict(_live_dates(client))  # all unchanged

    studies, tables, report = script.matched_sample(
        client, aact_dates, n=100, aliases_dir=ALIASES, as_of=AS_OF, seed=0
    )
    kept = set(tables.trial["nct_id"].to_list())
    assert kept == set(ids) - {unknown, finished}
    assert len(studies) == len(kept)
    assert report["unchanged"] == len(ids)
    assert report["live_not_running"] == 1
    assert report["live_finished"] == 1
    assert report["matched"] == len(ids) - 2


def test_parity_file_is_what_the_trainer_reads(tmp_path: Path) -> None:
    """parity.json holds only feature shares plus the "exempt" list read_parity skips; the run's
    metadata goes to a sibling file, so the trainer's comparison.parity carries features only."""
    shares = {f: 0.0 for f in FEATURES_V2}
    shares["sponsor_prior_n"] = 0.2  # sponsor features: reported, exempt
    out = tmp_path / "parity.json"
    script.write_parity(out, shares, {"n_trials": 7, "as_of": "2026-01-01"})
    assert trainer.read_parity(out) == shares
    assert trainer.parity_result(trainer.read_parity(out))[0] is True
    raw = json.loads(out.read_text())
    assert raw["exempt"] == sorted(trainer.SPONSOR_FEATURES)
    meta = json.loads((tmp_path / "parity.meta.json").read_text())
    assert meta == {"n_trials": 7, "as_of": "2026-01-01"}
    assert not any(math.isnan(v) for v in trainer.read_parity(out).values())
