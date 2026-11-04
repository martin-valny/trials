"""Per-trial tracked state and its stable hash (spec section 6)."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import date
from typing import Any

import polars as pl

from trialradar.tables import Tables
from trialradar.textnorm import Aliases, apply_alias, norm_key, norm_text

TrackedState = dict[str, dict[str, Any]]
"""NCT ID -> {tracked field -> JSON-serialisable value}."""

SNAPSHOT_SCHEMA: dict[str, pl.DataType] = {
    "nct_id": pl.Utf8(),
    "snapshot_date": pl.Date(),
    "tracked_hash": pl.Utf8(),
}

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


def _display_list(values: Iterable[str | None]) -> list[str]:
    """Display strings de-duplicated by ``norm_key``, sorted by key.

    When several variants share a key the lexicographically smallest is kept, so
    the result does not depend on input order.
    """
    best: dict[str, str] = {}
    for v in values:
        text = norm_text(v)
        if text is None:
            continue
        key = norm_key(text)
        if key not in best or text < best[key]:
            best[key] = text
    return [best[k] for k in sorted(best)]


def outcome_key(pair: Sequence[str | None]) -> tuple[str, str]:
    """Comparison key of a stored ``[measure, time_frame]`` pair."""
    return (norm_key(pair[0] or ""), norm_key(pair[1] or ""))


def _outcome_pairs(rows: Iterable[dict[str, Any]]) -> list[list[str | None]]:
    """``[measure, time_frame]`` display pairs de-duplicated and sorted by key."""
    best: dict[tuple[str, str], tuple[str, str]] = {}
    shown: dict[tuple[str, str], list[str | None]] = {}
    for o in rows:
        pair = [norm_text(o["measure"]), norm_text(o["time_frame"])]
        key = outcome_key(pair)
        order = (pair[0] or "", pair[1] or "")
        if key not in best or order < best[key]:
            best[key], shown[key] = order, pair
    return [shown[k] for k in sorted(shown)]


def _group(df_rows: list[dict[str, Any]]) -> defaultdict[str, list[dict[str, Any]]]:
    out: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in df_rows:
        out[r["nct_id"]].append(r)
    return out


def tracked_state(
    tables: Tables, fields: Sequence[str], aliases: Aliases | None = None
) -> TrackedState:
    """Build the comparable state for every trial, restricted to ``fields``.

    List fields hold readable display text (``norm_text`` form, original casing),
    de-duplicated and sorted by ``norm_key``; ``diff`` compares them by key, so
    cosmetic edits and reordering never register as changes. Scalars are kept
    exactly as ``normalize`` produced them.

    With ``aliases`` the lead sponsor and intervention names are re-derived from the
    stored raw names using those (current) aliases, so editing an alias file never
    shows up as a change; without it the stored normalised names are used.
    """
    wanted = set(fields)
    conditions = _group(tables.condition.to_dicts())
    interventions = _group(tables.intervention.to_dicts())
    sites = _group(tables.site.to_dicts())
    leads = {
        r["nct_id"]: r["name"] for r in reversed(tables.sponsor.to_dicts()) if r["role"] == "lead"
    }
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
            full[f"{kind}_outcomes"] = _outcome_pairs(
                o for o in trial_outcomes if o["kind"] == kind
            )
        if aliases is not None:
            lead = leads.get(nct)
            if lead is not None:
                full["lead_sponsor"] = apply_alias(lead, aliases.sponsor) or None
            names = (apply_alias(i["name"], aliases.intervention) for i in interventions[nct])
        else:
            names = (i["name_normalized"] for i in interventions[nct])
        full["interventions"] = _display_list(names)
        full["conditions"] = _display_list(c["condition"] for c in conditions[nct])
        full["site_countries"] = _display_list(s["country"] for s in sites[nct])
        full["site_count"] = len(sites[nct])
        state[nct] = {k: v for k, v in full.items() if k in wanted}
    return state


def registry_dates(tables: Tables) -> dict[str, date]:
    """NCT ID -> registry last-update-post date, for trials that have one."""
    trial = tables.trial
    return {
        nct: d
        for nct, d in zip(trial["nct_id"].to_list(), trial["last_update_post_date"].to_list())
        if d is not None
    }


def snapshot_frame(state: TrackedState, day: date) -> pl.DataFrame:
    """``trial_snapshot`` rows for ``day``: one per trial, sorted by NCT ID."""
    rows = [
        {"nct_id": nct, "snapshot_date": day, "tracked_hash": tracked_hash(state[nct])}
        for nct in sorted(state)
    ]
    return pl.DataFrame(rows, schema=SNAPSHOT_SCHEMA)
