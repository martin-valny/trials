"""Artefact save/load: round trip, version guards, typical-rate rule, factor label coverage."""

from __future__ import annotations

import json
import shutil
from datetime import date
from pathlib import Path

import numpy as np
import polars as pl
import pytest
from _risk_synth import COLUMNS, make_data, single_thread  # noqa: F401

from trialradar.risk import artefacts
from trialradar.risk.artefacts import Card, Metrics, RiskArtefactError
from trialradar.risk.features import FEATURES
from trialradar.risk.model import fit_ensemble

REPO = Path(__file__).resolve().parents[3]


def _metrics() -> Metrics:
    return Metrics(auc=0.7, brier=0.1, n=10, positives=3, calibration=[])


def _card(**kw: object) -> Card:
    import sklearn

    base: dict[str, object] = {
        "version": "stop-risk-20261109",
        "trained_on": date(2026, 11, 9),
        "sklearn": sklearn.__version__,
        "shipped": "baseline",
        "shipped_reason": "baseline ships",
        "filter": {"phases": ["PHASE1"]},
        "features": list(FEATURES),
        "excluded": ["enrollment"],
        "split": {"train_end": "2015-12-31", "test": ["2016-01-01", "2019-12-31"]},
        "metrics": {
            "baseline": _metrics(),
            "boosted": _metrics(),
            "boosted_no_sites": _metrics(),
            "in_area": None,
        },
        "site_leak_flag": False,
        "typical": [
            {"phase": "phase 3", "sponsor": "all", "rate": 0.2, "n": 1000},
            {"phase": "phase 3", "sponsor": "industry", "rate": 0.3, "n": 500},
            {"phase": "phase 3", "sponsor": "other", "rate": 0.21, "n": 500},
            {"phase": "phase 2", "sponsor": "all", "rate": 0.2, "n": 1000},
            {"phase": "phase 2", "sponsor": "industry", "rate": 0.3, "n": 100},
            {"phase": "all", "sponsor": "all", "rate": 0.25, "n": 5000},
        ],
        "max_start_year": 2025,
        "sponsor_floor": 5,
        "n_train": 100,
        "n_test": 20,
    }
    base.update(kw)
    return Card.model_validate(base)


def _save(tmp_path: Path, card: Card) -> None:
    x, y = make_data(300)
    ens = fit_ensemble("baseline", x, y, COLUMNS, n_boot=2)
    heldout = pl.DataFrame({"phase_1": [1.0], "label": [0], "in_area": [False]})
    table = pl.DataFrame(
        {"sponsor": ["A"], "earlier": [6], "stopped": [1], "as_of": [date(2026, 11, 9)]}
    )
    artefacts.save(tmp_path, ens, ens, card, heldout, table)
    shutil.copy(REPO / "config" / "risk" / "factor_labels.csv", tmp_path / "factor_labels.csv")


def test_save_load_roundtrip(tmp_path: Path) -> None:
    card = _card()
    _save(tmp_path, card)
    loaded = artefacts.load(tmp_path)
    assert loaded.card == card
    x, _ = make_data(20)
    np.testing.assert_allclose(loaded.eval.predict(x)[0], loaded.shipped.predict(x)[0])
    assert loaded.sponsor_table["sponsor"].to_list() == ["A"]
    assert loaded.sponsor_table["as_of"].dtype == pl.Date
    assert set(loaded.factor_labels) == set(FEATURES)


def test_load_rejects_minor_version_mismatch(tmp_path: Path) -> None:
    _save(tmp_path, _card())
    raw = json.loads((tmp_path / "card.json").read_text())
    raw["sklearn"] = "1.8.0"
    (tmp_path / "card.json").write_text(json.dumps(raw))
    with pytest.raises(RiskArtefactError, match="sklearn"):
        artefacts.load(tmp_path)


def test_load_accepts_patch_difference(tmp_path: Path) -> None:
    import sklearn

    major, minor = sklearn.__version__.split(".")[:2]
    _save(tmp_path, _card(sklearn=f"{major}.{minor}.99"))
    artefacts.load(tmp_path)


def test_load_rejects_card_model_version_mismatch(tmp_path: Path) -> None:
    _save(tmp_path, _card())
    raw = json.loads((tmp_path / "card.json").read_text())
    raw["version"] = "stop-risk-19990101"
    (tmp_path / "card.json").write_text(json.dumps(raw))
    with pytest.raises(RiskArtefactError, match="version"):
        artefacts.load(tmp_path)


@pytest.mark.parametrize(
    "name", ["model.joblib", "card.json", "heldout.parquet", "sponsor_history.csv"]
)
def test_load_missing_file_raises(tmp_path: Path, name: str) -> None:
    _save(tmp_path, _card())
    (tmp_path / name).unlink()
    with pytest.raises(RiskArtefactError, match=name):
        artefacts.load(tmp_path)


def test_typical_rate_split_rule() -> None:
    card = _card()
    # industry differs by 0.10 and n >= 200: split used
    assert artefacts.typical_rate(card, ["PHASE3"], "INDUSTRY") == (
        0.3,
        "phase 3 drug trials, industry",
    )
    # other differs by only 0.01: phase-only rate
    assert artefacts.typical_rate(card, ["PHASE3"], "OTHER") == (0.2, "phase 3 drug trials")
    # industry differs but n < 200: phase-only rate
    assert artefacts.typical_rate(card, ["PHASE2"], "INDUSTRY") == (0.2, "phase 2 drug trials")
    # unknown sponsor class and unknown phase fall back
    assert artefacts.typical_rate(card, ["PHASE3"], None) == (0.2, "phase 3 drug trials")
    assert artefacts.typical_rate(card, ["PHASE1", "PHASE2"], None)[1] == ("phase 1-3 drug trials")


def test_factor_labels_cover_features() -> None:
    labels = artefacts.read_factor_labels(REPO / "config" / "risk" / "factor_labels.csv")
    assert set(FEATURES) <= set(labels)
    assert all(labels[f].up and labels[f].down for f in FEATURES)
