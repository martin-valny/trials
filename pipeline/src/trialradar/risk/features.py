"""The stop-risk feature frame: numeric, start-time facts only.

Never read here: why_stopped, enrollment, overall_status, actual completion dates, last
update date, site status. Only the columns named in this module are taken from the tables.

Sponsor class mapping: INDUSTRY -> sponsor_industry. NIH, FED, OTHER_GOV, OTHER and
NETWORK/INDIV -> sponsor_academic (non-commercial). A missing or UNKNOWN class sets neither.
Region: countries map to a fixed continent table; multi_region is 1 when sites span more
than one continent (unmapped countries are ignored).
"""

from __future__ import annotations

import re
from collections.abc import Mapping

import polars as pl

from trialradar.risk.fields import CATEGORIES, RiskFields
from trialradar.risk.sponsors import SPONSOR_FLOOR
from trialradar.tables import Tables

__all__ = ["CATEGORY_COLUMNS", "FEATURES", "SITE_FEATURES", "SPONSOR_FLOOR", "build"]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


CATEGORY_COLUMNS: tuple[str, ...] = tuple(f"cat_{_slug(c)}" for c in CATEGORIES)

SITE_FEATURES: tuple[str, ...] = ("n_sites", "n_countries", "multi_region")

FEATURES: tuple[str, ...] = (
    "phase_1",
    "phase_2",
    "phase_3",
    "randomized",
    "masking_level",
    "n_arms",
    "placebo_arm",
    "sponsor_industry",
    "sponsor_academic",
    "n_collaborators",
    *SITE_FEATURES,
    "n_primary_outcomes",
    "n_secondary_outcomes",
    "n_conditions",
    *CATEGORY_COLUMNS,
    "n_categories",
    "has_biological",
    "n_experimental_interventions",
    "start_year",
    "sponsor_prior_n",
    "sponsor_prior_rate",
    "sponsor_few_prior",
)

_MASKING = {"NONE": 0, "SINGLE": 1, "DOUBLE": 2, "TRIPLE": 3, "QUADRUPLE": 4}
_ACADEMIC = {"NIH", "FED", "OTHER_GOV", "OTHER", "NETWORK", "INDIV"}

_REGIONS: dict[str, tuple[str, ...]] = {
    "EU": (
        "Albania", "Armenia", "Austria", "Belarus", "Belgium", "Bosnia and Herzegovina",
        "Bulgaria", "Croatia", "Cyprus", "Czechia", "Czech Republic", "Denmark", "Estonia",
        "Finland", "France", "Georgia", "Germany", "Greece", "Hungary", "Iceland", "Ireland",
        "Italy", "Kosovo", "Latvia", "Lithuania", "Luxembourg", "Malta", "Moldova",
        "Montenegro", "Netherlands", "North Macedonia", "Norway", "Poland", "Portugal",
        "Romania", "Russia", "Russian Federation", "Serbia", "Slovakia", "Slovenia", "Spain",
        "Sweden", "Switzerland", "Turkey", "Turkiye", "Ukraine", "United Kingdom",
    ),
    "AS": (
        "Bangladesh", "China", "Hong Kong", "India", "Indonesia", "Iran", "Iraq", "Israel",
        "Japan", "Jordan", "Kazakhstan", "Korea, Republic of", "South Korea", "Kuwait",
        "Lebanon", "Malaysia", "Mongolia", "Nepal", "Pakistan", "Philippines", "Qatar",
        "Saudi Arabia", "Singapore", "Sri Lanka", "Syria", "Taiwan", "Thailand",
        "United Arab Emirates", "Uzbekistan", "Vietnam",
    ),
    "NA": ("United States", "Canada", "Mexico", "Puerto Rico"),
    "SA": (
        "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador", "Paraguay", "Peru",
        "Uruguay", "Venezuela",
    ),
    "AF": (
        "Algeria", "Botswana", "Cameroon", "Egypt", "Ethiopia", "Ghana", "Kenya", "Malawi",
        "Mali", "Morocco", "Mozambique", "Nigeria", "Rwanda", "Senegal", "South Africa",
        "Tanzania", "Tunisia", "Uganda", "Zambia", "Zimbabwe",
    ),
    "OC": ("Australia", "New Zealand"),
}  # fmt: skip
_CONTINENT = {country: code for code, names in _REGIONS.items() for country in names}


def build(
    tables: Tables,
    fields: Mapping[str, RiskFields],
    sponsor_counts: pl.DataFrame,
    *,
    max_start_year: int | None = None,
) -> pl.DataFrame:
    """One row per trial: nct_id plus FEATURES, numeric only (nulls allowed)."""
    trial = tables.trial.select(
        "nct_id", "phases", "allocation", "masking", "sponsor_class", "start_date"
    )
    ids = trial["nct_id"].to_list()

    def count_by(df: pl.DataFrame, name: str, where: pl.Expr | None = None) -> pl.DataFrame:
        src = df if where is None else df.filter(where)
        counts = src.group_by("nct_id").agg(pl.len().cast(pl.Int64).alias(name))
        return trial.select("nct_id").join(counts, on="nct_id", how="left").fill_null(0)

    parts = [
        count_by(tables.sponsor, "n_collaborators", pl.col("role") == "collaborator"),
        count_by(tables.outcome, "n_primary_outcomes", pl.col("kind") == "primary"),
        count_by(tables.outcome, "n_secondary_outcomes", pl.col("kind") == "secondary"),
        count_by(tables.condition, "n_conditions"),
        count_by(
            tables.intervention,
            "n_experimental_interventions",
            pl.col("type").is_in(["DRUG", "BIOLOGICAL"]),
        ),
        count_by(tables.intervention, "has_biological", pl.col("type") == "BIOLOGICAL").select(
            "nct_id", (pl.col("has_biological") > 0).cast(pl.Int64)
        ),
    ]

    sites = tables.site.filter(pl.col("country").is_not_null())
    region = sites.with_columns(
        pl.col("country").replace_strict(_CONTINENT, default=None).alias("region")
    )
    site_counts = (
        tables.site.group_by("nct_id").agg(pl.len().cast(pl.Int64).alias("n_sites"))
    ).join(
        region.group_by("nct_id").agg(
            pl.col("country").n_unique().cast(pl.Int64).alias("n_countries"),
            (pl.col("region").drop_nulls().n_unique() > 1).cast(pl.Int64).alias("multi_region"),
        ),
        on="nct_id",
        how="left",
    )
    site_frame = (
        trial.select("nct_id")
        .join(site_counts, on="nct_id", how="left")
        # No listed sites is unknown, not zero: all three stay null. Listed sites without a
        # country count as zero countries.
        .with_columns(
            pl.when(pl.col("n_sites").is_not_null()).then(pl.col(c).fill_null(0)).alias(c)
            for c in ("n_countries", "multi_region")
        )
    )

    field_rows = []
    for nct_id in ids:
        f = fields.get(nct_id)
        row: dict[str, int | None] = {
            "nct_id": None,
            "n_arms": f.n_arms if f else None,
            "placebo_arm": int(f.placebo_arm) if f else 0,
        }
        row.update(
            {
                col: int(bool(f and cat in f.categories))
                for col, cat in zip(CATEGORY_COLUMNS, CATEGORIES, strict=True)
            }
        )
        row["n_categories"] = len(f.categories) if f else 0
        field_rows.append(row)
    schema: dict[str, pl.DataType | type] = {
        "nct_id": pl.Utf8,
        "n_arms": pl.Int64,
        "placebo_arm": pl.Int64,
        **{col: pl.Int64 for col in CATEGORY_COLUMNS},
        "n_categories": pl.Int64,
    }
    field_frame = pl.DataFrame(field_rows, schema=schema).with_columns(pl.Series("nct_id", ids))

    start_year = pl.col("start_date").dt.year().cast(pl.Int64)
    if max_start_year is not None:
        start_year = start_year.clip(upper_bound=max_start_year)

    base = trial.select(
        "nct_id",
        pl.col("phases").list.contains("PHASE1").fill_null(False).cast(pl.Int64).alias("phase_1"),
        pl.col("phases").list.contains("PHASE2").fill_null(False).cast(pl.Int64).alias("phase_2"),
        pl.col("phases").list.contains("PHASE3").fill_null(False).cast(pl.Int64).alias("phase_3"),
        (pl.col("allocation") == "RANDOMIZED").fill_null(False).cast(pl.Int64).alias("randomized"),
        pl.col("masking")
        .replace_strict(_MASKING, default=None, return_dtype=pl.Int64)
        .alias("masking_level"),
        (pl.col("sponsor_class") == "INDUSTRY")
        .fill_null(False)
        .cast(pl.Int64)
        .alias("sponsor_industry"),
        pl.col("sponsor_class")
        .is_in(list(_ACADEMIC))
        .fill_null(False)
        .cast(pl.Int64)
        .alias("sponsor_academic"),
        start_year.alias("start_year"),
    )

    counts = sponsor_counts.select("nct_id", "sponsor_prior_n", "sponsor_prior_stopped")
    frame = base
    for part in (*parts, site_frame, field_frame, counts):
        frame = frame.join(part, on="nct_id", how="left")
    few = pl.col("sponsor_prior_n").fill_null(0) < SPONSOR_FLOOR
    frame = frame.with_columns(
        pl.col("sponsor_prior_n").fill_null(0),
        pl.when(few)
        .then(None)
        .otherwise(pl.col("sponsor_prior_stopped") / pl.col("sponsor_prior_n"))
        .alias("sponsor_prior_rate"),
        few.cast(pl.Int64).alias("sponsor_few_prior"),
    )
    return frame.select("nct_id", *FEATURES)
