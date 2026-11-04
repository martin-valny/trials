from __future__ import annotations

import json
from datetime import date

from conftest import REPO_ROOT

from trialradar.normalize import normalize
from trialradar.quality import check
from trialradar.tables import SCHEMAS, Tables

ALIASES = REPO_ROOT / "config" / "aliases"
STUDIES = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "studies"


def assert_schemas(tables: Tables) -> None:
    for name in SCHEMAS:
        df = getattr(tables, name)
        assert dict(df.schema) == SCHEMAS[name], name
        assert df.columns == list(SCHEMAS[name]), name


def test_month_date_recorded() -> None:
    study = json.loads((STUDIES / "month_date.json").read_text())
    row = normalize([study], ALIASES).trial.row(0, named=True)
    assert row["start_date"] == date(2013, 10, 1)
    assert row["start_date_precision"] == "month"
    assert row["start_date_type"] is None


def test_sample20_normalizes_and_checks(cfg) -> None:  # type: ignore[no-untyped-def]
    studies = [
        json.loads(line)
        for line in (STUDIES / "sample20.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert len(studies) == 20
    tables = normalize(studies, ALIASES)
    assert tables.trial.height == 20
    assert_schemas(tables)
    report = check(studies, tables, None, cfg)
    assert report.errors == []
    assert report.warnings == []
