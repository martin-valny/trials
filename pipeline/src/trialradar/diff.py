"""Field-level change detection between two tracked states (spec section 6)."""

from __future__ import annotations

from datetime import date
from typing import Any

import polars as pl

from trialradar.config import AreaConfig
from trialradar.textnorm import norm_key
from trialradar.tracked import TrackedState, outcome_key, to_json, tracked_hash

TRIAL_CHANGE_SCHEMA: dict[str, pl.DataType] = {
    "nct_id": pl.Utf8(),
    "field": pl.Utf8(),
    "old_value": pl.Utf8(),
    "new_value": pl.Utf8(),
    "detected_date": pl.Date(),
    "registry_update_date": pl.Date(),
    "delta_days": pl.Int64(),
    "notable": pl.Boolean(),
    "notable_reason": pl.Utf8(),
}

_DATE_FIELDS = frozenset({"start_date", "primary_completion_date", "completion_date"})
_SLIP_FIELDS = frozenset({"primary_completion_date", "completion_date"})
_KEYED_LISTS = frozenset({"conditions", "interventions", "site_countries"})
_OUTCOME_LISTS = frozenset({"primary_outcomes", "secondary_outcomes"})

# Reason strings are fixed identifiers consumed downstream; they keep their
# default-threshold wording ("20pct", "90d") even when the thresholds in
# config are changed.
_R_STATUS = "status_change"
_R_PRIMARY = "primary_endpoint_change"
_R_ENROLL = "enrollment_change_ge_20pct"
_R_SLIP = "date_slip_ge_90d"


def _same(field: str, old: Any, new: Any) -> bool:
    """Equality used for change detection: list fields compare by key sets."""
    if field in _KEYED_LISTS:
        return {norm_key(v) for v in old or []} == {norm_key(v) for v in new or []}
    if field in _OUTCOME_LISTS:
        return {outcome_key(p) for p in old or []} == {outcome_key(p) for p in new or []}
    return to_json(old) == to_json(new)


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _delta_days(old: dict[str, Any] | None, new: dict[str, Any] | None) -> int | None:
    if old is None or new is None:
        return None
    od, nd = date.fromisoformat(old["date"]), date.fromisoformat(new["date"])
    # A month-precision date refined to any day in the same month is not a slip.
    if old.get("precision") == "month" and (od.year, od.month) == (nd.year, nd.month):
        return 0
    return (nd - od).days


def _reason(field: str, old: Any, new: Any, delta: int | None, cfg: AreaConfig) -> str | None:
    """First matching notable reason, in spec order, or ``None``."""
    th = cfg.thresholds
    if field == "overall_status":
        return _R_STATUS
    if field == "primary_outcomes":
        return _R_PRIMARY
    if field == "enrollment" and _is_int(old) and old > 0 and _is_int(new):
        # Division (not multiplication) keeps exact-threshold cases like 30 -> 36 inclusive.
        if abs(new - old) / old >= th.enrollment_rel_change:
            return _R_ENROLL
        return None
    if field in _SLIP_FIELDS and delta is not None and delta >= th.date_slip_days:
        return _R_SLIP
    return None


def _row(
    nct: str,
    field: str,
    old_json: str | None,
    new_json: str,
    day: date,
    registry: date | None,
    delta: int | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    return {
        "nct_id": nct,
        "field": field,
        "old_value": old_json,
        "new_value": new_json,
        "detected_date": day,
        "registry_update_date": registry,
        "delta_days": delta,
        "notable": reason is not None,
        "notable_reason": reason,
    }


def diff(
    prev: TrackedState | None,
    curr: TrackedState,
    registry_dates: dict[str, date],
    cfg: AreaConfig,
    day: date,
) -> pl.DataFrame:
    """Change rows from ``prev`` to ``curr``; ``prev is None`` is the baseline (no rows).

    Only fields listed in ``cfg.tracked_fields`` and present in both states are
    compared. ``_tracked`` membership rows are always emitted.
    """
    rows: list[dict[str, Any]] = []
    if prev is not None:
        tracked = set(cfg.tracked_fields)
        for nct in sorted(prev.keys() | curr.keys()):
            if nct not in curr:
                rows.append(
                    _row(nct, "_tracked", to_json("present"), to_json("removed"), day, None)
                )
                continue
            registry = registry_dates.get(nct)
            if nct not in prev:
                rows.append(_row(nct, "_tracked", None, to_json("added"), day, registry))
                continue
            old_s, new_s = prev[nct], curr[nct]
            # Fast path: the hash covers the whole (display) dict, so equal hashes mean
            # equal states. Unequal hashes may still be cosmetic-only; _same decides.
            if tracked_hash(old_s) == tracked_hash(new_s):
                continue
            for field in sorted(old_s.keys() & new_s.keys() & tracked):
                old, new = old_s[field], new_s[field]
                if _same(field, old, new):
                    continue
                old_json, new_json = to_json(old), to_json(new)
                delta = _delta_days(old, new) if field in _DATE_FIELDS else None
                reason = _reason(field, old, new, delta, cfg)
                rows.append(_row(nct, field, old_json, new_json, day, registry, delta, reason))
    return pl.DataFrame(rows, schema=TRIAL_CHANGE_SCHEMA)
