"""Integration fixtures: a fake CT.gov client and a deterministic multi-day study set.

The base set is the in-area part of ``sample20.jsonl`` (via the relevance filter),
topped up with ``make_study`` clones to at least ``MIN_RELEVANT`` trials, plus two
off-topic studies that must reach the raw snapshot but never the tables or site.
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
MIN_RELEVANT = 12
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
    return make_study(
        nct_id,
        **{
            "conditionsModule.conditions": ["Multiple Sclerosis"],
            "statusModule.primaryCompletionDateStruct": {"date": "2026-06-01", "type": "ESTIMATED"},
        },
    )


def off_topic(nct_id: str) -> dict[str, Any]:
    return make_study(nct_id, **{"conditionsModule.conditions": ["Healthy"]})


def day1_studies(cfg: AreaConfig) -> list[dict[str, Any]]:
    sample = [json.loads(line) for line in SAMPLE.read_text(encoding="utf-8").splitlines() if line]
    relevant = filter_relevant(sample, cfg)
    clones = [clone(f"NCT9000000{i}") for i in range(1, 5)]
    i = 5
    while len(relevant) + len(clones) < MIN_RELEVANT:
        clones.append(clone(f"NCT900000{i:02d}"))
        i += 1
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
        self.cfg = cfg
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


@pytest.fixture
def env(tmp_path: Path, cfg: AreaConfig) -> Env:
    return Env(tmp_path, cfg)
