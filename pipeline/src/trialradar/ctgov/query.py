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
