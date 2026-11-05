"""Site JSON export: the contract consumed by the web frontend (spec sections 4.1, 7, 8)."""

from __future__ import annotations

import contextlib
import json
import os
import re
from collections import defaultdict
from collections.abc import Mapping
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import polars as pl

from trialradar.config import AreaConfig
from trialradar.explorer.extras import StudyExtras
from trialradar.tables import Tables

WINDOWS: tuple[int, ...] = (1, 7, 30)
_STUDY_URL = "https://clinicaltrials.gov/study/"
_TRIAL_FILE = re.compile(r"NCT\d+\.json")
_NCT_ID = re.compile(r"NCT\d+")
_DATE_FIELDS = ("start_date", "primary_completion_date", "completion_date")


def _write_json(path: Path, doc: Any) -> None:
    """Atomically write ``doc`` as compact, key-sorted UTF-8 JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n"
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()
        raise


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d is not None else None


def _decode(raw: str | None, nct_id: str, field: str, which: str) -> Any:
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"malformed JSON in {which} of {nct_id}/{field}: {exc}") from exc


def _change_items(changes: pl.DataFrame, trials: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = changes.sort(
        ["detected_date", "nct_id", "field"], descending=[True, False, False], maintain_order=True
    )
    items: list[dict[str, Any]] = []
    for r in ordered.iter_rows(named=True):
        nct, field = r["nct_id"], r["field"]
        trial = trials.get(nct)
        items.append(
            {
                "nct_id": nct,
                "title": trial["title"] if trial else None,
                "lead_sponsor": trial["lead_sponsor"] if trial else None,
                "field": field,
                "old_value": _decode(r["old_value"], nct, field, "old_value"),
                "new_value": _decode(r["new_value"], nct, field, "new_value"),
                "detected_date": _iso(r["detected_date"]),
                "delta_days": r["delta_days"],
                "notable": bool(r["notable"]),
                "notable_reason": r["notable_reason"],
                "source_url": _STUDY_URL + nct,
            }
        )
    return items


def _date_obj(row: dict[str, Any], name: str) -> dict[str, Any] | None:
    if row[name] is None:
        return None
    return {
        "date": row[name].isoformat(),
        "precision": row[f"{name}_precision"],
        "type": row[f"{name}_type"],
    }


def _group(df: pl.DataFrame) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in df.iter_rows(named=True):
        out[r["nct_id"]].append(r)
    return out


def _trial_docs(
    tables: Tables, items: list[dict[str, Any]], extras: Mapping[str, StudyExtras]
) -> dict[str, dict[str, Any]]:
    conds, intervs = _group(tables.condition), _group(tables.intervention)
    sites, outs = _group(tables.site), _group(tables.outcome)
    item_by_trial: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for it in items:
        item_by_trial[it["nct_id"]].append(it)

    docs: dict[str, dict[str, Any]] = {}
    for r in tables.trial.iter_rows(named=True):
        nct = r["nct_id"]
        x = extras.get(nct)
        site_rows = sites.get(nct, [])
        outcomes = outs.get(nct, [])

        def pick(kind: str, rows: list[dict[str, Any]] = outcomes) -> list[dict[str, Any]]:
            return [
                {"measure": o["measure"], "time_frame": o["time_frame"]}
                for o in rows
                if o["kind"] == kind
            ]

        docs[nct] = {
            "nct_id": nct,
            "title": r["title"],
            "phases": list(r["phases"] or []),
            "overall_status": r["overall_status"],
            "why_stopped": r["why_stopped"],
            **{f: _date_obj(r, f) for f in _DATE_FIELDS},
            "enrollment": r["enrollment"],
            "enrollment_type": r["enrollment_type"],
            "lead_sponsor": r["lead_sponsor"],
            "sponsor_class": r["sponsor_class"],
            "masking": r["masking"],
            "allocation": r["allocation"],
            "last_update_post_date": _iso(r["last_update_post_date"]),
            "conditions": [c["condition"] for c in conds.get(nct, [])],
            "interventions": [
                {"type": i["type"], "name": i["name_normalized"]} for i in intervs.get(nct, [])
            ],
            "countries": sorted({s["country"] for s in site_rows if s["country"] is not None}),
            "site_count": len(site_rows),
            "primary_outcomes": pick("primary"),
            "secondary_outcomes": pick("secondary"),
            "changes": item_by_trial.get(nct, []),
            "source_url": _STUDY_URL + nct,
            "brief_summary": x.brief_summary if x else None,
            "eligibility": {
                "sex": x.sex if x else None,
                "min_age_years": x.min_age_years if x else None,
                "max_age_years": x.max_age_years if x else None,
            },
            "has_results": x.has_results if x else False,
        }
    return docs


def _index(docs: dict[str, dict[str, Any]], day: date) -> dict[str, Any]:
    """One row per tracked trial for the browse view; sorted so output is stable."""
    rows = []
    for nct in sorted(docs):
        d = docs[nct]
        rows.append(
            {
                "nct_id": nct,
                "title": d["title"],
                "overall_status": d["overall_status"],
                "phases": d["phases"],
                "lead_sponsor": d["lead_sponsor"],
                "start_date": d["start_date"],
                "primary_completion_date": d["primary_completion_date"],
                "enrollment": d["enrollment"],
                "last_change": max((c["detected_date"] for c in d["changes"]), default=None),
            }
        )
    return {"generated_for": day.isoformat(), "trials": rows}


def _meta(tables: Tables, run_log: pl.DataFrame, cfg: AreaConfig, day: date) -> dict[str, Any]:
    ok = run_log.filter(pl.col("status") == "success")
    last_success_at: str | None = None
    tracking_since: str | None = None
    data_timestamp: str | None = None
    warnings: list[Any] = []
    if ok.height:
        # Stable sort: ties on started_at keep file order, so the last one wins.
        row = ok.sort("started_at", maintain_order=True).row(-1, named=True)
        started: datetime = row["started_at"]
        last_success_at = started.isoformat(timespec="seconds") + "Z"
        first: datetime = ok["started_at"].min()  # type: ignore[assignment]
        tracking_since = first.date().isoformat()
        data_timestamp = row["data_timestamp"]
        warnings = json.loads(row["warnings"]) if row["warnings"] else []
        if not isinstance(warnings, list) or not all(isinstance(w, str) for w in warnings):
            raise ValueError("run_log column 'warnings' must be a JSON list of strings")
    return {
        "area": cfg.name,
        "conditions": [c.label for c in cfg.conditions],
        "generated_for": day.isoformat(),
        "trial_count": tables.trial.height,
        "last_success_at": last_success_at,
        "tracking_since": tracking_since,
        "data_timestamp": data_timestamp,
        "warnings": warnings,
    }


def export(
    tables: Tables,
    changes: pl.DataFrame,
    run_log: pl.DataFrame,
    cfg: AreaConfig,
    day: date,
    out_dir: Path,
    *,
    extras: Mapping[str, StudyExtras] | None = None,
    explorer: dict[str, Any] | None = None,
) -> None:
    """Write the site JSON views for ``day`` into ``out_dir``.

    ``extras`` add the registry summary, eligibility and results flag to the trial
    files (null/false when absent); ``explorer`` is written as ``explorer.json``."""
    current = {r["nct_id"]: r for r in tables.trial.iter_rows(named=True)}
    for nct in current:
        if not isinstance(nct, str) or not _NCT_ID.fullmatch(nct):
            raise ValueError(f"invalid nct_id {nct!r}: expected NCT followed by digits")
    items = _change_items(changes, current)

    for n in WINDOWS:
        lo = (day - timedelta(days=n)).isoformat()
        hi = day.isoformat()
        window = [i for i in items if lo < i["detected_date"] <= hi]
        _write_json(
            out_dir / "changes" / f"{n}d.json",
            {"window_days": n, "generated_for": hi, "changes": window},
        )

    docs = _trial_docs(tables, items, extras or {})
    trials_dir = out_dir / "trials"
    trials_dir.mkdir(parents=True, exist_ok=True)
    for nct, doc in docs.items():
        _write_json(trials_dir / f"{nct}.json", doc)
    for p in trials_dir.iterdir():
        if _TRIAL_FILE.fullmatch(p.name) and p.is_file() and p.stem not in docs:
            p.unlink()

    _write_json(out_dir / "trials.json", _index(docs, day))
    if explorer is not None:
        _write_json(out_dir / "explorer.json", explorer)
    _write_json(out_dir / "meta.json", _meta(tables, run_log, cfg, day))
