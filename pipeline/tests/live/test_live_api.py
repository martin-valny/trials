"""Smoke test against the real ClinicalTrials.gov API (weekly ``pytest -m live`` only)."""

from __future__ import annotations

from itertools import islice

import pytest

from trialradar import quality
from trialradar.config import AreaConfig
from trialradar.ctgov.client import CtGovClient
from trialradar.normalize import normalize
from trialradar.relevance import filter_relevant

pytestmark = pytest.mark.live

PAGE_SIZE = 1000


def test_data_timestamp_is_non_empty() -> None:
    ts = CtGovClient().data_timestamp()
    assert isinstance(ts, str)
    assert ts


def test_first_page_normalises_and_passes_quality(cfg: AreaConfig) -> None:
    # iter_studies de-duplicates across pages before yielding, so this still
    # crawls the whole (small) tracked set; only the first page's worth is checked.
    raw = list(islice(CtGovClient().iter_studies(cfg), PAGE_SIZE))
    assert raw, "the configured query returned no studies"
    assert quality.check_raw(raw) == []
    relevant = filter_relevant(raw, cfg)
    tables = normalize(relevant, cfg.aliases_dir)
    report = quality.check(relevant, tables, None, cfg, fetched_count=len(raw))
    assert report.errors == []
