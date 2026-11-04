"""One-off recorder: save real ClinicalTrials.gov API v2 payloads as test fixtures.

Run from ``pipeline/`` (needs network access to clinicaltrials.gov):
``uv run python scripts/record_fixtures.py``. Exits non-zero if any label finds no
match within MAX_STUDIES relevant studies, or if fewer than MIN_DISTINCT distinct relevant
studies were seen. Only studies passing the relevance filter are ever selected.
"""

from __future__ import annotations

import json
import re
import sys
import time
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from trialradar.config import AreaConfig, load_config
from trialradar.relevance import is_relevant

BASE_URL = "https://clinicaltrials.gov/api/v2"
PAGE_SIZE = 1000
MAX_STUDIES = 3000
MIN_DISTINCT = 20
SAMPLE_SIZE = 20
TIMEOUT = 30.0
ATTEMPTS = 4

PIPELINE_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = PIPELINE_DIR.parent / "config" / "area.yaml"
FIXTURES_DIR = PIPELINE_DIR / "tests" / "fixtures"

Study = dict[str, Any]


def _section(study: Study, name: str) -> dict[str, Any]:
    section = study.get("protocolSection", {}).get(name)
    return section if isinstance(section, dict) else {}


def month_date(study: Study) -> bool:
    date = _section(study, "statusModule").get("startDateStruct", {}).get("date")
    return isinstance(date, str) and re.fullmatch(r"\d{4}-\d{2}", date) is not None


def multi_phase(study: Study) -> bool:
    return len(_section(study, "designModule").get("phases") or []) >= 2


def no_sites(study: Study) -> bool:
    return not _section(study, "contactsLocationsModule").get("locations")


def no_enrollment(study: Study) -> bool:
    return _section(study, "designModule").get("enrollmentInfo", {}).get("count") is None


def terminated_with_reason(study: Study) -> bool:
    status = _section(study, "statusModule")
    return status.get("overallStatus") == "TERMINATED" and bool(status.get("whyStopped"))


def many_sites(study: Study) -> bool:
    return len(_section(study, "contactsLocationsModule").get("locations") or []) >= 20


PREDICATES: dict[str, Callable[[Study], bool]] = {
    "month_date": month_date,
    "multi_phase": multi_phase,
    "no_sites": no_sites,
    "no_enrollment": no_enrollment,
    "terminated_with_reason": terminated_with_reason,
    "many_sites": many_sites,
}


def build_params(cfg: AreaConfig) -> dict[str, Any]:
    synonyms = [s for spec in cfg.conditions for s in spec.synonyms]
    cond = " OR ".join(f'"{s}"' if " " in s else s for s in synonyms)
    phases = " OR ".join(f"AREA[Phase]{p}" for p in cfg.phases)
    return {
        "query.cond": cond,
        "filter.advanced": f"AREA[StudyType]{cfg.study_type} AND ({phases})",
        "pageSize": PAGE_SIZE,
        "format": "json",
    }


def _get(client: httpx.Client, path: str, params: dict[str, Any] | None = None) -> Any:
    for attempt in range(ATTEMPTS):
        resp = client.get(f"{BASE_URL}{path}", params=params)
        retryable = resp.status_code == 429 or resp.status_code >= 500
        if retryable and attempt < ATTEMPTS - 1:
            time.sleep(2**attempt)
            continue
        resp.raise_for_status()
        return resp.json()
    raise AssertionError("unreachable")


def iter_studies(client: httpx.Client, params: dict[str, Any]) -> Iterator[Study]:
    page_params = dict(params)
    while True:
        payload = _get(client, "/studies", page_params)
        yield from payload.get("studies", [])
        token = payload.get("nextPageToken")
        if not token:
            return
        page_params["pageToken"] = token


def _nct_id(study: Study) -> str:
    return str(_section(study, "identificationModule")["nctId"])


@dataclass
class Selection:
    found: dict[str, Study] = field(default_factory=dict)
    sample: list[Study] = field(default_factory=list)
    fetched: int = 0
    relevant: int = 0


def select_studies(
    studies: Iterable[Study], cfg: AreaConfig, max_studies: int = MAX_STUDIES
) -> Selection:
    """Pick labelled fixtures and the sample from distinct, in-area studies only."""
    sel = Selection()
    seen: set[str] = set()
    for study in studies:
        nct = _nct_id(study)
        if nct in seen:
            continue
        seen.add(nct)
        sel.fetched += 1
        if not is_relevant(study, cfg):
            continue
        sel.relevant += 1
        if len(sel.sample) < SAMPLE_SIZE:
            sel.sample.append(study)
        for label, predicate in PREDICATES.items():
            if label not in sel.found and predicate(study):
                sel.found[label] = study
        if sel.relevant >= max_studies or (
            len(sel.found) == len(PREDICATES) and len(sel.sample) >= SAMPLE_SIZE
        ):
            break
    return sel


def main() -> int:
    cfg = load_config(CONFIG_PATH)
    params = build_params(cfg)
    with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as client:
        version = _get(client, "/version")
        sel = select_studies(iter_studies(client, params), cfg)
    found, sample = sel.found, sel.sample

    missing = sorted(set(PREDICATES) - set(found))
    if missing or sel.relevant < MIN_DISTINCT:
        print(
            f"FAILED: no match for {missing}; distinct relevant studies seen: {sel.relevant} "
            f"(of {sel.fetched} fetched)",
            file=sys.stderr,
        )
        return 1

    studies_dir = FIXTURES_DIR / "studies"
    http_dir = FIXTURES_DIR / "http"
    studies_dir.mkdir(parents=True, exist_ok=True)
    http_dir.mkdir(parents=True, exist_ok=True)
    for label, study in found.items():
        (studies_dir / f"{label}.json").write_text(json.dumps(study, indent=2) + "\n")
    (studies_dir / "sample20.jsonl").write_text("".join(json.dumps(s) + "\n" for s in sample))
    (http_dir / "version.json").write_text(json.dumps(version, indent=2) + "\n")
    print(
        f"Recorded {len(found)} labelled studies, {len(sample)} samples from "
        f"{sel.relevant} relevant of {sel.fetched} fetched."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
