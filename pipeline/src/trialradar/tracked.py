"""Per-trial tracked state and its stable hash (spec section 6)."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from collections.abc import Sequence
from datetime import date
from typing import Any

from trialradar.tables import Tables
from trialradar.textnorm import norm_key

TrackedState = dict[str, dict[str, Any]]
"""NCT ID -> {tracked field -> JSON-serialisable value}."""

_SCALARS = ("overall_status", "why_stopped", "enrollment", "enrollment_type", "lead_sponsor")
_DATES = ("start_date", "primary_completion_date", "completion_date")


def to_json(value: Any) -> str:
    """Canonical JSON used for both hashing and stored change values."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def tracked_hash(fields: dict[str, Any]) -> str:
    """SHA-256 hex digest of the canonical JSON of ``fields``."""
    return hashlib.sha256(to_json(fields).encode("utf-8")).hexdigest()


def _date_value(row: dict[str, Any], prefix: str) -> dict[str, Any] | None:
    d: date | None = row[prefix]
    if d is None:
        return None
    return {
        "date": d.isoformat(),
        "precision": row[f"{prefix}_precision"],
        "type": row[f"{prefix}_type"],
    }


def _group(df_rows: list[dict[str, Any]]) -> defaultdict[str, list[dict[str, Any]]]:
    out: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in df_rows:
        out[r["nct_id"]].append(r)
    return out


def tracked_state(tables: Tables, fields: Sequence[str]) -> TrackedState:
    """Build the comparable state for every trial, restricted to ``fields``.

    List fields are sorted, de-duplicated and case/whitespace-normalised with
    ``norm_key`` so cosmetic edits and reordering never register as changes.
    Scalars are kept exactly as ``normalize`` produced them.
    """
    wanted = set(fields)
    conditions = _group(tables.condition.to_dicts())
    interventions = _group(tables.intervention.to_dicts())
    sites = _group(tables.site.to_dicts())
    outcomes = _group(tables.outcome.to_dicts())

    state: TrackedState = {}
    for row in tables.trial.to_dicts():
        nct = row["nct_id"]
        trial_outcomes = outcomes[nct]
        full: dict[str, Any] = {name: row[name] for name in _SCALARS}
        full["phases"] = list(row["phases"] or [])
        for prefix in _DATES:
            full[prefix] = _date_value(row, prefix)
        for kind in ("primary", "secondary"):
            pairs = {
                (norm_key(o["measure"] or ""), norm_key(o["time_frame"] or ""))
                for o in trial_outcomes
                if o["kind"] == kind
            }
            full[f"{kind}_outcomes"] = [list(p) for p in sorted(pairs)]
        full["interventions"] = sorted(
            {k for i in interventions[nct] if (k := norm_key(i["name_normalized"] or ""))}
        )
        full["conditions"] = sorted(
            {k for c in conditions[nct] if (k := norm_key(c["condition"] or ""))}
        )
        full["site_countries"] = sorted(
            {norm_key(s["country"]) for s in sites[nct] if s["country"]}
        )
        full["site_count"] = len(sites[nct])
        state[nct] = {k: v for k, v in full.items() if k in wanted}
    return state
