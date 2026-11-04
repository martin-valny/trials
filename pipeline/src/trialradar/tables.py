"""Typed table container and schemas (spec section 5)."""

from __future__ import annotations

from dataclasses import dataclass

import polars as pl

_L = pl.List(pl.Utf8)


def _date_cols(prefix: str) -> dict[str, pl.DataType]:
    return {
        prefix: pl.Date(),
        f"{prefix}_precision": pl.Utf8(),
        f"{prefix}_type": pl.Utf8(),
    }


SCHEMAS: dict[str, dict[str, pl.DataType]] = {
    "trial": {
        "nct_id": pl.Utf8(),
        "title": pl.Utf8(),
        "phases": _L,
        "overall_status": pl.Utf8(),
        "why_stopped": pl.Utf8(),
        **_date_cols("start_date"),
        **_date_cols("primary_completion_date"),
        **_date_cols("completion_date"),
        "enrollment": pl.Int64(),
        "enrollment_type": pl.Utf8(),
        "lead_sponsor": pl.Utf8(),
        "sponsor_class": pl.Utf8(),
        "masking": pl.Utf8(),
        "allocation": pl.Utf8(),
        "last_update_post_date": pl.Date(),
    },
    "condition": {"nct_id": pl.Utf8(), "condition": pl.Utf8()},
    "intervention": {
        "nct_id": pl.Utf8(),
        "type": pl.Utf8(),
        "name": pl.Utf8(),
        "name_normalized": pl.Utf8(),
    },
    "sponsor": {
        "nct_id": pl.Utf8(),
        "name": pl.Utf8(),
        "name_normalized": pl.Utf8(),
        "role": pl.Utf8(),
        "class": pl.Utf8(),
    },
    "site": {
        "nct_id": pl.Utf8(),
        "facility": pl.Utf8(),
        "city": pl.Utf8(),
        "country": pl.Utf8(),
        "status": pl.Utf8(),
    },
    "outcome": {
        "nct_id": pl.Utf8(),
        "kind": pl.Utf8(),
        "measure": pl.Utf8(),
        "time_frame": pl.Utf8(),
        "description": pl.Utf8(),
    },
}


@dataclass(frozen=True)
class Tables:
    trial: pl.DataFrame
    condition: pl.DataFrame
    intervention: pl.DataFrame
    sponsor: pl.DataFrame
    site: pl.DataFrame
    outcome: pl.DataFrame

    @classmethod
    def empty(cls) -> Tables:
        return cls(**{name: pl.DataFrame(schema=schema) for name, schema in SCHEMAS.items()})
