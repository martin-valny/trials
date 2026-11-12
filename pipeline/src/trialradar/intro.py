"""The intro page's data: one compact, columnar document over the explorer's trials."""

from __future__ import annotations

import statistics
from datetime import date
from typing import Any

_BINS: dict[str, str] = {
    "completion_date": "dates",
    "primary_completion_date": "dates",
    "start_date": "dates",
    "overall_status": "status",
    "why_stopped": "status",
    "site_count": "sites",
    "site_countries": "sites",
    "enrollment": "enrollment",
    "enrollment_type": "enrollment",
    "primary_outcomes": "outcomes",
    "secondary_outcomes": "outcomes",
}


def _change_bins(changes: list[dict[str, Any]]) -> dict[str, list[Any]]:
    """Per trial: its first notable change's bin and reason, else its first change's bin."""
    first: dict[str, list[Any]] = {}
    for c in changes:
        nct = c["nct_id"]
        entry = [_BINS.get(c["field"], "other"), c.get("notable_reason") if c["notable"] else None]
        held = first.get(nct)
        if held is None or (held[1] is None and entry[1] is not None):
            first[nct] = entry
    return first


def build_intro_doc(
    explorer: dict[str, Any],
    pipeline: dict[str, Any] | None,
    risk: dict[str, Any] | None,
    changes: list[dict[str, Any]],
    day: date,
) -> dict[str, Any]:
    """Parallel arrays, one entry per explorer trial in explorer order."""
    rows = pipeline["rows"] if pipeline else []
    marks: dict[str, list[list[Any]]] = {}
    dz: dict[str, list[str]] = {}
    for i, row in enumerate(rows):
        for m in row["marks"]:
            marks.setdefault(m["n"], []).append([i, m["c"], m["s"]])
            seen = dz.setdefault(m["n"], [])
            seen.extend(c for c in m.get("dz", ()) if c not in seen)
    risks = risk["trials"] if risk else {}
    typical = [r["typical"] for r in risks.values() if r.get("typical") is not None]
    bins = _change_bins(changes)
    trials = explorer["trials"]
    ids = [t["nct_id"] for t in trials]
    return {
        "generated_for": day.isoformat(),
        "trial_count": len(trials),
        "approaches": explorer["approaches"],
        "rows": [{"id": r["id"], "label": r["label"]} for r in rows],
        "typical": round(statistics.median(typical), 3) if typical else None,
        "trials": {
            "id": ids,
            "x": [round(t["x"], 3) for t in trials],
            "y": [round(t["y"], 3) for t in trials],
            "outcome": [t["outcome"] for t in trials],
            "approaches": [t["approaches"] for t in trials],
            "start": [t.get("start_year") for t in trials],
            "dz": [dz.get(n, []) for n in ids],
            "marks": [marks.get(n, []) for n in ids],
            "risk": [risks[n]["p"] if n in risks else None for n in ids],
            "change": [bins.get(n) for n in ids],
        },
    }
