"""One AACT panel snapshot -> the same Tables + RiskFields the daily run builds from the API.

Train/serve consistency: every value is mapped onto the CT.gov API v2 spelling that
``trialradar.normalize`` emits, through the text, alias and date helpers it uses, so
``risk.features.build`` runs unchanged on a snapshot. AACT spellings changed when AACT moved
to API v2 data (2023): older archives say "Phase 1/Phase 2", "Anticipated", "Double
(Participant, Investigator)"; newer ones say "PHASE1/PHASE2", "ESTIMATED", "DOUBLE".
``ENUM_MAPS`` covers both; any other value raises ``UnmappedValue`` instead of passing through.

Always null from AACT (the panel does not keep them; no risk feature reads them):
``trial.title``, ``trial.why_stopped``, ``trial.completion_date_type``, ``outcome.measure``, ``outcome.time_frame``,
``outcome.description``. AACT stores month-precision dates as full dates, so date precision is
"day" for most AACT rows where the API would say "month".
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl

from trialradar.risk.fields import PLACEBO_ARMS, RiskFields, categories_from
from trialradar.tables import SCHEMAS, Tables
from trialradar.textnorm import Aliases, apply_alias, norm_text, parse_ct_date

_STATUS = {
    "RECRUITING": "Recruiting",
    "NOT_YET_RECRUITING": "Not yet recruiting",
    "ACTIVE_NOT_RECRUITING": "Active, not recruiting",
    "ENROLLING_BY_INVITATION": "Enrolling by invitation",
    "COMPLETED": "Completed",
    "TERMINATED": "Terminated",
    "SUSPENDED": "Suspended",
    "WITHDRAWN": "Withdrawn",
    "UNKNOWN": "Unknown status",
    "WITHHELD": "Withheld",
    "AVAILABLE": "Available",
    "NO_LONGER_AVAILABLE": "No longer available",
    "TEMPORARILY_NOT_AVAILABLE": "Temporarily not available",
    "APPROVED_FOR_MARKETING": "Approved for marketing",
}
_STATUS_MAP = {**{v: k for k, v in _STATUS.items()}, **{k: k for k in _STATUS}}

_DATE_TYPE = {
    "ACTUAL": "ACTUAL",
    "Actual": "ACTUAL",
    "ESTIMATED": "ESTIMATED",
    "Estimated": "ESTIMATED",
    "Anticipated": "ESTIMATED",
    "Estimate": "ESTIMATED",
}

_AGENCY = {
    "INDUSTRY": "INDUSTRY",
    "Industry": "INDUSTRY",
    "NIH": "NIH",
    "FED": "FED",
    "U.S. Fed": "FED",
    "OTHER_GOV": "OTHER_GOV",
    "Other_gov": "OTHER_GOV",
    "OTHER": "OTHER",
    "Other": "OTHER",
    "NETWORK": "NETWORK",
    "INDIV": "INDIV",
    "Individual": "INDIV",
    "UNKNOWN": "UNKNOWN",
    "Unknown": "UNKNOWN",
    "AMBIG": "AMBIG",
}


def _same(*values: str) -> dict[str, str]:
    return {v: v for v in values}


ENUM_MAPS: dict[str, dict[str, str]] = {
    "phase": {
        **_same(
            "EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "PHASE1/PHASE2",
            "PHASE2/PHASE3", "NA",
        ),
        "Early Phase 1": "EARLY_PHASE1",
        "Phase 1": "PHASE1",
        "Phase 2": "PHASE2",
        "Phase 3": "PHASE3",
        "Phase 4": "PHASE4",
        "Phase 1/Phase 2": "PHASE1/PHASE2",
        "Phase 2/Phase 3": "PHASE2/PHASE3",
        "N/A": "NA",
    },
    "overall_status": _STATUS_MAP,
    "status": _STATUS_MAP,
    "intervention_type": {
        **_same(
            "DRUG", "BIOLOGICAL", "DEVICE", "PROCEDURE", "RADIATION", "BEHAVIORAL", "GENETIC",
            "DIETARY_SUPPLEMENT", "COMBINATION_PRODUCT", "DIAGNOSTIC_TEST", "OTHER",
        ),
        "Drug": "DRUG",
        "Biological": "BIOLOGICAL",
        "Device": "DEVICE",
        "Procedure": "PROCEDURE",
        "Procedure/Surgery": "PROCEDURE",
        "Radiation": "RADIATION",
        "Behavioral": "BEHAVIORAL",
        "Genetic": "GENETIC",
        "Dietary Supplement": "DIETARY_SUPPLEMENT",
        "Combination Product": "COMBINATION_PRODUCT",
        "Diagnostic Test": "DIAGNOSTIC_TEST",
        "Other": "OTHER",
    },
    "agency_class": _AGENCY,
    "source_class": _AGENCY,
    "lead_or_collaborator": _same("lead", "collaborator"),
    "allocation": {
        **_same("RANDOMIZED", "NON_RANDOMIZED", "NA"),
        "Randomized": "RANDOMIZED",
        "Non-Randomized": "NON_RANDOMIZED",
        "N/A": "NA",
    },
    "masking": {
        **_same("NONE", "SINGLE", "DOUBLE", "TRIPLE", "QUADRUPLE"),
        "None": "NONE",
        "Open Label": "NONE",
        "Single": "SINGLE",
        "Single Blind": "SINGLE",
        "Double": "DOUBLE",
        "Double Blind": "DOUBLE",
        "Triple": "TRIPLE",
        "Quadruple": "QUADRUPLE",
    },
    "group_type": {
        **_same(
            "EXPERIMENTAL", "ACTIVE_COMPARATOR", "PLACEBO_COMPARATOR", "SHAM_COMPARATOR",
            "NO_INTERVENTION", "OTHER",
        ),
        "Experimental": "EXPERIMENTAL",
        "Active Comparator": "ACTIVE_COMPARATOR",
        "Placebo Comparator": "PLACEBO_COMPARATOR",
        "Sham Comparator": "SHAM_COMPARATOR",
        "No Intervention": "NO_INTERVENTION",
        "Other": "OTHER",
    },
    "outcome_type": {"primary": "primary", "secondary": "secondary", "other": "other"},
    "enrollment_type": _DATE_TYPE,
    "start_date_type": _DATE_TYPE,
    "primary_completion_date_type": _DATE_TYPE,
    "mesh_type": {"mesh-list": "mesh", "mesh-ancestor": "ancestor"},
}  # fmt: skip
"""AACT column -> {AACT spelling -> API v2 spelling}. Lookup ignores case and surrounding
whitespace; masking also ignores the "(Participant, ...)" suffix. ``mesh_type`` maps to the
browse-module key ("mesh" = direct term, "ancestor")."""

_PAREN = re.compile(r"\s*\(.*\)\s*$")
_LOOKUP = {col: {k.casefold(): v for k, v in m.items()} for col, m in ENUM_MAPS.items()}


class UnmappedValue(Exception):
    """An AACT enum value with no API v2 spelling in ENUM_MAPS."""

    def __init__(self, table: str, column: str, values: list[str]) -> None:
        self.table, self.column, self.values = table, column, values
        super().__init__(f"unmapped AACT value(s) in {table}.{column}: {values!r}")


def map_value(table: str, column: str, value: str | None) -> str | None:
    """API spelling of one AACT value; None/blank stays None; unknown raises UnmappedValue."""
    if value is None or not value.strip():
        return None
    key = value.strip()
    if column == "masking":
        key = _PAREN.sub("", key)
    out = _LOOKUP[column].get(key.casefold())
    if out is None:
        raise UnmappedValue(table, column, [value])
    return out


@dataclass(frozen=True)
class Snapshot:
    date: date
    tables: Tables
    fields: dict[str, RiskFields]
    has_results: set[str]


def _via(
    df: pl.DataFrame, col: str, fn: Callable[[Any], Any], dtype: pl.DataType, alias: str
) -> pl.Expr:
    """Apply ``fn`` once per distinct value of ``df[col]`` (nulls stay null)."""
    lut = {v: fn(v) for v in df[col].drop_nulls().unique().to_list()}
    return pl.col(col).replace_strict(lut, default=None, return_dtype=dtype).alias(alias)


def _enum(df: pl.DataFrame, table: str, col: str, alias: str | None = None) -> pl.Expr:
    values = df[col].drop_nulls().unique().to_list()
    bad: list[str] = []
    for v in values:
        try:
            map_value(table, col, v)
        except UnmappedValue:
            bad.append(v)
    if bad:
        raise UnmappedValue(table, col, sorted(bad))
    return _via(df, col, lambda v: map_value(table, col, v), pl.Utf8(), alias or col)


def _text(df: pl.DataFrame, col: str, alias: str | None = None) -> pl.Expr:
    return _via(df, col, norm_text, pl.Utf8(), alias or col)


def _date_exprs(df: pl.DataFrame, col: str) -> list[pl.Expr]:
    lut = {v: parse_ct_date(v) for v in df[col].drop_nulls().unique().to_list()}
    return [
        pl.col(col).replace_strict({k: d for k, (d, _) in lut.items()}, default=None,
                                   return_dtype=pl.Date()).alias(col),
        pl.col(col).replace_strict({k: p for k, (_, p) in lut.items()}, default=None,
                                   return_dtype=pl.Utf8()).alias(f"{col}_precision"),
    ]  # fmt: skip


def _read(panel_dir: Path, table: str, snap_date: date) -> pl.DataFrame:
    return pl.read_parquet(panel_dir / table / f"{snap_date.isoformat()}.parquet")


def _frame(name: str, df: pl.DataFrame) -> pl.DataFrame:
    """Select and cast to SCHEMAS[name] exactly; absent columns become typed nulls."""
    schema = SCHEMAS[name]
    return df.select(
        pl.col(c).cast(t) if c in df.columns else pl.lit(None, dtype=t).alias(c)
        for c, t in schema.items()
    )


def load_snapshot(panel_dir: Path, snap_date: date, *, aliases: Aliases | None = None) -> Snapshot:
    """Tables, RiskFields and has-results ids for one panel snapshot date.

    ``aliases`` are the sponsor/intervention alias maps the daily run applies (default: none,
    so ``name_normalized`` is the whitespace-normalised name, as with an empty alias dir).
    """
    al = aliases or Aliases.empty()
    raw = {t: _read(panel_dir, t, snap_date) for t in (
        "studies", "interventions", "facilities", "design_groups", "design_outcomes",
        "conditions", "browse_conditions", "sponsors", "designs",
    )}  # fmt: skip

    st = raw["studies"]
    studies = st.select(
        "nct_id",
        _enum(st, "studies", "phase"),
        _enum(st, "studies", "overall_status"),
        *_date_exprs(st, "start_date"),
        _enum(st, "studies", "start_date_type"),
        *_date_exprs(st, "primary_completion_date"),
        _enum(st, "studies", "primary_completion_date_type"),
        *_date_exprs(st, "completion_date"),
        pl.col("enrollment").cast(pl.Float64).cast(pl.Int64),
        _enum(st, "studies", "enrollment_type"),
        _date_exprs(st, "last_update_posted_date")[0].alias("last_update_post_date"),
        _date_exprs(st, "results_first_posted_date")[0].alias("results_first_posted"),
        _enum(st, "studies", "source_class"),
    ).with_columns(
        pl.col("phase").str.split("/").list.sort().fill_null(pl.lit([], dtype=pl.List(pl.Utf8)))
        .alias("phases"),
        # The panel keeps no completion_date_type.
        pl.lit(None, dtype=pl.Utf8).alias("completion_date_type"),
    )  # fmt: skip

    sp = raw["sponsors"]
    sponsor = sp.select(
        "nct_id",
        _text(sp, "name"),
        _enum(sp, "sponsors", "lead_or_collaborator", "role"),
        _enum(sp, "sponsors", "agency_class", "class"),
    ).filter(pl.col("name").is_not_null())
    sponsor = (
        sponsor.with_columns(
            _via(sponsor, "name", lambda n: apply_alias(n, al.sponsor), pl.Utf8(),
                 "name_normalized")
        )
        # normalize lists the lead sponsor first, then collaborators in order.
        .with_row_index("_i")
        .sort(pl.col("_i").min().over("nct_id"), pl.col("role") != "lead", "_i")
    )  # fmt: skip
    lead = (
        sponsor.filter(pl.col("role") == "lead")
        .unique("nct_id", keep="first", maintain_order=True)
        .select("nct_id", pl.col("name_normalized").alias("lead_sponsor"),
                pl.col("class").alias("lead_class"))
    )  # fmt: skip
    # Fill a missing lead class from studies.source_class (the lead sponsor's class).
    lead_with_class = lead.join(
        studies.select("nct_id", "source_class"), on="nct_id", how="left", maintain_order="left"
    )
    sponsor = sponsor.join(
        lead_with_class.select("nct_id", pl.col("source_class").alias("_src")),
        on="nct_id",
        how="left",
        maintain_order="left",
    ).with_columns(
        pl.when(pl.col("role") == "lead")
        .then(pl.col("class").fill_null(pl.col("_src")))
        .otherwise(pl.col("class"))
        .alias("class")
    )

    dz = raw["designs"].unique("nct_id", keep="first", maintain_order=True)
    designs = dz.select(
        "nct_id", _enum(dz, "designs", "allocation"), _enum(dz, "designs", "masking")
    )

    trial = (
        studies.join(lead_with_class, on="nct_id", how="left", maintain_order="left")
        .join(designs, on="nct_id", how="left", maintain_order="left")
        .with_columns(
            pl.when(pl.col("lead_sponsor").is_not_null())
            .then(pl.col("lead_class").fill_null(pl.col("source_class")))
            .alias("sponsor_class")
        )
    )

    cd = raw["conditions"]
    condition = cd.select("nct_id", _text(cd, "name", "condition")).filter(
        pl.col("condition").is_not_null()
    )

    iv = raw["interventions"]
    intervention = iv.select(
        "nct_id", _enum(iv, "interventions", "intervention_type", "type"), _text(iv, "name")
    ).filter(pl.col("name").is_not_null())
    intervention = intervention.with_columns(
        _via(intervention, "name", lambda n: apply_alias(n, al.intervention), pl.Utf8(),
             "name_normalized")
    )  # fmt: skip

    fc = raw["facilities"]
    site = fc.select(
        "nct_id",
        _text(fc, "name", "facility"),
        _text(fc, "city"),
        _text(fc, "country"),
        _enum(fc, "facilities", "status"),
    )

    oc = raw["design_outcomes"]
    outcome = oc.select("nct_id", _enum(oc, "design_outcomes", "outcome_type", "kind")).filter(
        pl.col("kind").is_in(["primary", "secondary"])
    )

    tables = Tables(
        trial=_frame("trial", trial),
        condition=_frame("condition", condition),
        intervention=_frame("intervention", intervention),
        sponsor=_frame("sponsor", sponsor),
        site=_frame("site", site),
        outcome=_frame("outcome", outcome),
    )

    dg = raw["design_groups"]
    groups = dg.select("nct_id", _enum(dg, "design_groups", "group_type"))
    arms: dict[str, list[str | None]] = {}
    for nct, gt in groups.iter_rows():
        arms.setdefault(nct, []).append(gt)
    bc = raw["browse_conditions"]
    terms: dict[str, dict[str, set[str]]] = {}
    for nct, term, kind in bc.select(
        "nct_id", "mesh_term", _enum(bc, "browse_conditions", "mesh_type")
    ).iter_rows():
        if term:
            terms.setdefault(nct, {"mesh": set(), "ancestor": set()})[kind].add(term)
    fields: dict[str, RiskFields] = {}
    for nct in studies["nct_id"].to_list():
        g = arms.get(nct, [])
        t = terms.get(nct, {})
        fields[nct] = RiskFields(
            nct_id=nct,
            n_arms=len(g) or None,
            placebo_arm=any(x in PLACEBO_ARMS for x in g),
            categories=categories_from(t.get("mesh", set()), t.get("ancestor", set())),
        )

    has_results = set(
        studies.filter(pl.col("results_first_posted") <= snap_date)["nct_id"].to_list()
    )
    return Snapshot(date=snap_date, tables=tables, fields=fields, has_results=has_results)


__all__ = ["ENUM_MAPS", "Snapshot", "UnmappedValue", "load_snapshot", "map_value"]
