"""Integration fixtures: a fake CT.gov client and a deterministic multi-day study set.

The base set is a FIXED number (``REAL_COUNT``) of in-area studies from
``sample20.jsonl`` (via the relevance filter) plus a FIXED set of ``make_study``
clones, so it does not depend on what a re-recording contains, plus two off-topic studies that must reach the raw snapshot but never the tables or site.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from conftest import REPO_ROOT, make_study

from trialradar.config import AreaConfig
from trialradar.ctgov.client import CtGovClient
from trialradar.relevance import filter_relevant
from trialradar.store import Store

SAMPLE = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "studies" / "sample20.jsonl"
REAL_COUNT = 6
CLONE_COUNT = 8
OFF_TOPIC = ("NCT98000001", "NCT98000002")
# Clones with fixed roles in the day-2 edits.
STATUS_EDIT = "NCT90000001"
DATE_EDIT = "NCT90000002"
REMOVED = "NCT90000003"
COSMETIC = "NCT90000004"
ADDED = "NCT90000099"


def nct(study: dict[str, Any]) -> str:
    return str(study["protocolSection"]["identificationModule"]["nctId"])


def clone(nct_id: str) -> dict[str, Any]:
    # Clones differ in their number of secondary outcomes so the stop-risk estimates spread.
    secondary = [
        {"measure": f"Secondary outcome {k}", "timeFrame": "96 weeks"}
        for k in range(int(nct_id[-2:]) % 6 * 2 + 1)
    ]
    return make_study(
        nct_id,
        **{
            "conditionsModule.conditions": ["Multiple Sclerosis"],
            "outcomesModule.secondaryOutcomes": secondary,
            "statusModule.primaryCompletionDateStruct": {"date": "2026-06-01", "type": "ESTIMATED"},
        },
    )


def off_topic(nct_id: str) -> dict[str, Any]:
    return make_study(nct_id, **{"conditionsModule.conditions": ["Healthy"]})


def day1_studies(cfg: AreaConfig) -> list[dict[str, Any]]:
    sample = [json.loads(line) for line in SAMPLE.read_text(encoding="utf-8").splitlines() if line]
    in_area = filter_relevant(sample, cfg)
    assert len(in_area) >= REAL_COUNT, (
        f"sample20.jsonl has only {len(in_area)} in-area studies; need {REAL_COUNT}"
    )
    relevant = in_area[:REAL_COUNT]
    clones = [clone(f"NCT9000000{i}") for i in range(1, CLONE_COUNT + 1)]
    return relevant + clones + [off_topic(n) for n in OFF_TOPIC]


def day2_studies(cfg: AreaConfig) -> list[dict[str, Any]]:
    """Day 1 with: status -> TERMINATED, primary completion +120 days, one study
    removed, one added, one cosmetic-only edit (condition case and whitespace)."""
    out: list[dict[str, Any]] = []
    for s in copy.deepcopy(day1_studies(cfg)):
        status = s["protocolSection"]["statusModule"]
        if nct(s) == REMOVED:
            continue
        if nct(s) == STATUS_EDIT:
            status["overallStatus"] = "TERMINATED"
        if nct(s) == DATE_EDIT:
            status["primaryCompletionDateStruct"]["date"] = "2026-09-29"
        if nct(s) == COSMETIC:
            s["protocolSection"]["conditionsModule"]["conditions"] = ["  MULTIPLE   sclerosis "]
        out.append(s)
    out.append(clone(ADDED))
    return out


def relevant_ids(cfg: AreaConfig, studies: list[dict[str, Any]]) -> list[str]:
    return sorted(nct(s) for s in filter_relevant(studies, cfg))


class FakeClient(CtGovClient):
    """Canned responses; never touches the network."""

    def __init__(
        self,
        timestamp: str,
        studies: list[dict[str, Any]],
        fail_on: str | None = None,
        exc: Exception | None = None,
    ) -> None:
        self.timestamp = timestamp
        self.studies = studies
        self.fail_on = fail_on
        self.exc = exc
        self.fetches = 0

    def data_timestamp(self) -> str:
        if self.fail_on == "data_timestamp" and self.exc is not None:
            raise self.exc
        return self.timestamp

    def iter_studies(self, cfg: AreaConfig) -> Iterator[dict[str, Any]]:
        self.fetches += 1
        for i, s in enumerate(copy.deepcopy(self.studies)):
            if self.fail_on == "iter_studies" and self.exc is not None and i == 3:
                raise self.exc
            yield s


class Env:
    """Directories and a deterministic clock for one simulated deployment."""

    def __init__(self, root: Path, cfg: AreaConfig) -> None:
        fixtures = Path(__file__).resolve().parents[1] / "fixtures"
        self.cfg = cfg.model_copy(
            update={
                "mechanisms_dir": fixtures / "mechanisms",
                "approaches_dir": fixtures / "approaches",
                "sponsors_dir": fixtures / "sponsors",
                "approvals_dir": fixtures / "approvals",
                "risk": cfg.risk.model_copy(update={"dir": fixtures / "risk"}),
            }
        )
        self.store_root = root / "data"
        self.raw_dir = root / "raw"
        self.site_dir = root / "site"
        self.aliases_dir = root / "aliases"
        self.aliases_dir.mkdir()
        for name in ("sponsor.csv", "intervention.csv"):
            (self.aliases_dir / name).write_text("raw,normalized\n", encoding="utf-8")
        self.store = Store(self.store_root)
        self._tick = 0

    def clock(self, day: date) -> Callable[[], datetime]:
        self._tick += 1
        base = datetime(day.year, day.month, day.day, 7, 17) + timedelta(minutes=self._tick)
        return lambda: base

    def run(self, client: CtGovClient, day: date, **kw: Any) -> Any:
        from trialradar.pipeline import run

        return run(
            self.cfg,
            client,
            self.store,
            self.raw_dir,
            self.site_dir,
            day,
            aliases_dir=self.aliases_dir,
            now=self.clock(day),
            run_id=f"run-{self._tick}",
            **kw,
        )


def tree_bytes(root: Path, exclude: tuple[str, ...] = ()) -> dict[str, bytes]:
    """relative path -> bytes for every file under ``root`` (missing root -> {})."""
    if not root.exists():
        return {}
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file() and p.relative_to(root).as_posix() not in exclude
    }


def without_coords(site: Path) -> dict[str, Any]:
    """``site/explorer.json`` with each trial's x/y/z removed: UMAP coordinates are
    not byte-stable across platforms, and a rebuild lays the map out afresh."""
    doc: dict[str, Any] = json.loads((site / "explorer.json").read_text(encoding="utf-8"))
    for t in doc["trials"]:
        del t["x"], t["y"], t["z"]
    return doc


def without_graph_coords(site: Path) -> dict[str, Any]:
    """``site/mechanisms.json`` with each node's x/y removed (see ``without_coords``)."""
    doc: dict[str, Any] = json.loads((site / "mechanisms.json").read_text(encoding="utf-8"))
    for n in doc["nodes"]:
        del n["x"], n["y"]
    return doc


def without_intro_coords(site: Path) -> dict[str, Any]:
    """``site/intro.json`` with the map coordinates removed (see ``without_coords``)."""
    doc: dict[str, Any] = json.loads((site / "intro.json").read_text(encoding="utf-8"))
    del doc["trials"]["x"], doc["trials"]["y"]
    return doc


@pytest.fixture
def env(tmp_path: Path, cfg: AreaConfig) -> Env:
    return Env(tmp_path, cfg)
