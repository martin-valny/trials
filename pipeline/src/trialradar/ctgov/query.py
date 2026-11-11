"""Build ClinicalTrials.gov v2 query parameters from the area configuration."""

from __future__ import annotations

from trialradar.config import AreaConfig

PAGE_SIZE = 1000


def build_params(cfg: AreaConfig) -> dict[str, str]:
    synonyms = [s for spec in cfg.conditions for s in spec.synonyms]
    cond = " OR ".join(f'"{s}"' if " " in s else s for s in synonyms)
    phases = " OR ".join(f"AREA[Phase]{p}" for p in cfg.phases)
    return {
        "query.cond": cond,
        "filter.advanced": f"AREA[StudyType]{cfg.study_type} AND ({phases})",
        "pageSize": str(PAGE_SIZE),
        "format": "json",
    }


def build_training_params(start_year: int) -> dict[str, str]:
    """Registry-wide query for the stop-risk training set: finished phase 1-3 drug trials that
    started in ``start_year`` (no condition filter)."""
    advanced = " AND ".join(
        [
            "AREA[StudyType]INTERVENTIONAL",
            "(AREA[Phase]PHASE1 OR AREA[Phase]PHASE2 OR AREA[Phase]PHASE3)",
            "AREA[OverallStatus](COMPLETED OR TERMINATED)",
            "AREA[InterventionType](DRUG OR BIOLOGICAL)",
            f"AREA[StartDate]RANGE[{start_year}-01-01,{start_year}-12-31]",
        ]
    )
    return {"filter.advanced": advanced, "pageSize": str(PAGE_SIZE), "format": "json"}
