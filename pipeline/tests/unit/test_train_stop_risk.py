"""The training script, offline, on a synthetic per-year cache."""

from __future__ import annotations

import gzip
import importlib.util
import json
import random
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import polars as pl
import pytest
from _risk_synth import single_thread  # noqa: F401
from conftest import make_study

from trialradar.risk import artefacts
from trialradar.risk.features import FEATURES

_SPEC = importlib.util.spec_from_file_location(
    "train_stop_risk", Path(__file__).resolve().parents[2] / "scripts" / "train_stop_risk.py"
)
assert _SPEC and _SPEC.loader
script = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(script)


def _studies() -> dict[int, list[dict[str, Any]]]:
    rng = random.Random(0)
    out: dict[int, list[dict[str, Any]]] = {}
    for i in range(480):
        year = 2008 + i % 12
        n_primary = rng.randint(1, 4)
        industry = rng.random() < 0.5
        # planted signal: many primary outcomes and academic sponsors stop more often
        p = 0.1 + 0.15 * (n_primary - 1) + (0.0 if industry else 0.15)
        stopped = rng.random() < p
        sponsor = f"Sponsor {i % 7}"
        study = make_study(
            f"NCT{i + 1:08d}",
            mesh_terms=["Neoplasms"] if i % 3 == 0 else ["Infections"],
            **{
                "statusModule.overallStatus": "TERMINATED" if stopped else "COMPLETED",
                "statusModule.startDateStruct": {"date": f"{year}-03", "type": "ACTUAL"},
                "statusModule.completionDateStruct": {
                    "date": f"{year + 1 + i % 3}-06",
                    "type": "ACTUAL",
                },
                "designModule.phases": [["PHASE1"], ["PHASE2"], ["PHASE3"]][i % 3],
                "sponsorCollaboratorsModule.leadSponsor": {
                    "name": sponsor,
                    "class": "INDUSTRY" if industry else "OTHER",
                },
                "outcomesModule.primaryOutcomes": [
                    {"measure": f"m{j}", "timeFrame": "1 y"} for j in range(n_primary)
                ],
                "armsInterventionsModule.armGroups": [
                    {"label": f"a{j}", "type": "EXPERIMENTAL"} for j in range(1 + i % 3)
                ],
                "armsInterventionsModule.interventions": [{"type": "DRUG", "name": f"d{i}"}],
                "conditionsModule.conditions": ["Multiple Sclerosis" if i % 5 == 0 else "Asthma"],
            },
        )
        out.setdefault(year, []).append(study)
    # one running trial and one out-of-scope trial that must be ignored
    out[2010].append(make_study("NCT90000001"))
    out[2010].append(
        make_study(
            "NCT90000002",
            **{
                "statusModule.overallStatus": "COMPLETED",
                "armsInterventionsModule.interventions": [{"type": "DEVICE", "name": "x"}],
            },
        )
    )
    return out


@pytest.fixture(scope="module")
def trained(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    cache = tmp_path_factory.mktemp("cache")
    for year, studies in _studies().items():
        with gzip.open(cache / f"{year}.jsonl.gz", "wt") as fh:
            for s in studies:
                fh.write(json.dumps(s) + "\n")
    out = tmp_path_factory.mktemp("out")
    argv = ["--cache", str(cache), "--out", str(out), "--offline", "--years", "2008-2019"]
    assert script.main([*argv, "--n-boot", "3"]) == 0
    return cache, out


def test_train_script_offline_on_fixture(trained: tuple[Path, Path]) -> None:
    _, out = trained
    for name in (
        "model.joblib",
        "card.json",
        "heldout.parquet",
        "sponsor_history.csv",
        "factor_labels.csv",
        "README.md",
    ):
        assert (out / name).exists(), name
    loaded = artefacts.load(out)
    card = loaded.card
    assert card.n_test > 0 and card.n_train > 0
    assert card.shipped in {"baseline", "boosted"}
    assert card.shipped_reason
    assert card.n_train + card.n_test <= 480
    assert card.max_start_year == 2019


def test_site_ablation_reported(trained: tuple[Path, Path]) -> None:
    card = artefacts.load(trained[1]).card
    assert card.metrics.boosted_no_sites.n == card.n_test
    assert isinstance(card.site_leak_flag, bool)
    assert card.metrics.in_area is not None  # MS studies exist in the test years


def test_heldout_has_no_ids_or_text(trained: tuple[Path, Path]) -> None:
    held = pl.read_parquet(trained[1] / "heldout.parquet")
    assert set(held.columns) <= {*FEATURES, "label", "in_area"}
    assert held.height > 0


def test_offline_with_empty_cache_trains_nothing(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    argv = ["--cache", str(empty), "--out", str(tmp_path / "o"), "--offline"]
    assert script.main(argv) == 1
    assert not (tmp_path / "o" / "card.json").exists()


class _StubClient:
    def iter_query(self, params: dict[str, str]) -> Iterator[dict[str, Any]]:
        assert "2012-01-01" in params["filter.advanced"]
        yield make_study("NCT00000001")
        yield make_study("NCT00000002")


def test_fetch_year_writes_cache_atomically(tmp_path: Path) -> None:
    path = tmp_path / "2012.jsonl.gz"
    assert script._fetch_year(_StubClient(), 2012, path) == 2  # type: ignore[arg-type]
    assert [
        s["protocolSection"]["identificationModule"]["nctId"] for s in script._read_cache(path)
    ] == [
        "NCT00000001",
        "NCT00000002",
    ]
    assert not list(tmp_path.glob("*.part"))


def test_reason_and_leak_flag_match_card_metrics(trained: tuple[Path, Path]) -> None:
    card = artefacts.load(trained[1]).card
    m = card.metrics
    assert m.baseline.auc is not None and m.boosted.auc is not None
    assert m.boosted_no_sites.auc is not None
    assert f"AUC {m.boosted.auc:.3f}" in card.shipped_reason
    assert f"{m.baseline.auc:.3f}" in card.shipped_reason
    assert f"Brier {m.boosted.brier:.4f}" in card.shipped_reason
    assert f"{m.baseline.brier:.4f}" in card.shipped_reason
    assert card.site_leak_flag == (m.boosted.auc - m.boosted_no_sites.auc > script.LEAK_DROP)
