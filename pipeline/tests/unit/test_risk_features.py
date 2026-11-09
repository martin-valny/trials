from __future__ import annotations

import polars as pl
from conftest import DELETE, REPO_ROOT, make_study

from trialradar.normalize import normalize
from trialradar.risk import features
from trialradar.risk.features import FEATURES, SPONSOR_FLOOR
from trialradar.risk.fields import risk_fields


def _build(studies, counts=None, **kw):
    tables = normalize(studies, REPO_ROOT / "config" / "aliases")
    fields = {
        s["protocolSection"]["identificationModule"]["nctId"]: risk_fields(s) for s in studies
    }
    if counts is None:
        counts = pl.DataFrame(
            {
                "nct_id": list(fields),
                "sponsor_prior_n": [0] * len(fields),
                "sponsor_prior_stopped": [0] * len(fields),
            }
        )
    return features.build(tables, fields, counts, **kw)


def test_build_columns_exact():
    frame = _build([make_study("NCT00000001")])
    assert list(frame.columns) == ["nct_id", *FEATURES]
    assert frame.height == 1


def test_build_never_reads_end_facts():
    a = make_study("NCT00000001")
    b = make_study(
        "NCT00000001",
        **{
            "designModule.enrollmentInfo": {"count": 9999, "type": "ACTUAL"},
            "statusModule.whyStopped": "Sponsor decision",
            "statusModule.completionDateStruct": {"date": "2019-01", "type": "ACTUAL"},
            "statusModule.primaryCompletionDateStruct": {"date": "2018-01", "type": "ACTUAL"},
            "statusModule.overallStatus": "TERMINATED",
            "statusModule.lastUpdatePostDateStruct": {"date": "2020-05-05"},
        },
    )
    assert _build([a]).equals(_build([b]))


def _with_n(n):
    studies = [make_study("NCT00000001")]
    counts = pl.DataFrame(
        {"nct_id": ["NCT00000001"], "sponsor_prior_n": [n], "sponsor_prior_stopped": [1]}
    )
    return _build(studies, counts).row(0, named=True)


def test_sponsor_floor():
    low = _with_n(SPONSOR_FLOOR - 1)
    assert low["sponsor_prior_rate"] is None
    assert low["sponsor_few_prior"] == 1
    ok = _with_n(SPONSOR_FLOOR)
    assert ok["sponsor_prior_rate"] == 1 / SPONSOR_FLOOR
    assert ok["sponsor_few_prior"] == 0


def test_start_year_clamped():
    s = make_study("NCT00000001", **{"statusModule.startDateStruct": {"date": "2024-03"}})
    assert _build([s], max_start_year=2023).row(0, named=True)["start_year"] == 2023
    assert _build([s]).row(0, named=True)["start_year"] == 2024


def test_build_basic_values():
    s = make_study(
        "NCT00000001",
        **{"designModule.phases": ["PHASE1", "PHASE2"]},
    )
    row = _build([s]).row(0, named=True)
    assert (row["phase_1"], row["phase_2"], row["phase_3"]) == (1, 1, 0)
    assert row["randomized"] == 1
    assert row["masking_level"] == 2
    assert row["sponsor_industry"] == 1
    assert row["n_sites"] == 1
    assert row["n_countries"] == 1
    assert row["multi_region"] == 0
    assert row["n_primary_outcomes"] == 1
    assert row["n_experimental_interventions"] == 1


def test_build_missing_everything():
    s = make_study(
        "NCT00000001",
        **{
            "contactsLocationsModule": DELETE,
            "sponsorCollaboratorsModule": DELETE,
            "statusModule.startDateStruct": DELETE,
            "designModule": DELETE,
            "outcomesModule": DELETE,
            "conditionsModule": DELETE,
            "armsInterventionsModule": DELETE,
        },
    )
    tables = normalize([s], REPO_ROOT / "config" / "aliases")
    counts = pl.DataFrame(
        schema={"nct_id": pl.Utf8, "sponsor_prior_n": pl.Int64, "sponsor_prior_stopped": pl.Int64}
    )
    frame = features.build(tables, {}, counts)
    assert frame.height == 1
    assert list(frame.columns) == ["nct_id", *FEATURES]
