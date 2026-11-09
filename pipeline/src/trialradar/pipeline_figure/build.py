"""Build ``pipeline.json``: the front-door Pipeline figure's one data file.

Spec §6. Pure: the explorer document, the trial table and the hand-kept config in, one
JSON-ready dict out. The web app reads nothing else on the front page.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any

import polars as pl

from trialradar.approvals.io import Approval
from trialradar.config import AreaConfig
from trialradar.pipeline_figure.io import FigureConfig, norm_sponsor
from trialradar.pipeline_figure.rules import (
    COLUMN,
    mark_state,
    parent_of,
    placements,
    reason_group,
    span,
    sponsor_display,
    unlisted_classes,
)

TITLE_MAX = 80
WHY_MAX = 300
UNLISTED_SPONSOR_MIN = 3
_NOT_GIVEN = "Not given"


def _codes(labels: Sequence[str], by_label: Mapping[str, str]) -> list[str]:
    return [by_label[label] for label in labels if label in by_label]


def _join(items: Sequence[tuple[str, int]]) -> str:
    return ", ".join(f"{name} ({n})" for name, n in items)


def _ap_entry(a: Approval) -> dict[str, Any]:
    entry: dict[str, Any] = {"d": a.drug, "src": list(a.sources), "url": a.url}
    # Default-valued keys are omitted (readers treat absent as the default).
    if a.withdrawn:
        entry["wd"] = True
    if a.regulator:
        entry["reg"] = a.regulator
    if a.year is not None:
        entry["y"] = a.year
    return entry


def _approved_cells(
    approvals: Sequence[Approval],
    row_ids: set[str],
    codes: set[str],
    warnings: list[str],
) -> dict[tuple[str, str], list[dict[str, Any]]]:
    """Approved drugs per (row, disease): not-withdrawn first, then withdrawn, file order within.

    Lines for a row or disease the figure doesn't have are skipped, with one warning."""
    unknown: set[str] = set()
    cells: dict[tuple[str, str], list[Approval]] = defaultdict(list)
    for a in approvals:
        if a.row_id not in row_ids or a.disease not in codes:
            unknown.add(f"{a.row_id} \u00d7 {a.disease}")
            continue
        cells[(a.row_id, a.disease)].append(a)
    if unknown:
        warnings.append(f"approvals_unknown: {', '.join(sorted(unknown))}")
    return {
        key: [_ap_entry(a) for a in sorted(items, key=lambda a: a.withdrawn)]  # stable
        for key, items in cells.items()
    }


def build_pipeline_doc(
    explorer: Mapping[str, Any],
    trial: pl.DataFrame,
    cfg: AreaConfig,
    fig: FigureConfig,
    day: date,
    warnings: list[str],
    approvals: Sequence[Approval] = (),
) -> dict[str, Any]:
    by_label = {c.label: c.code for c in cfg.conditions if c.code}
    coded = [c for c in cfg.conditions if c.code]
    coded.sort(
        key=lambda c: (c.figure_order is None, c.figure_order or 0)
    )  # stable: ties keep config order
    diseases = [{"code": c.code, "label": c.label} for c in coded]
    table: dict[str, dict[str, Any]] = {r["nct_id"]: r for r in trial.iter_rows(named=True)}
    drug_index: Mapping[str, Mapping[str, Any]] = explorer.get("drug_index", {})
    drug_mechanisms = {d: list(v.get("mechanisms", ())) for d, v in drug_index.items()}
    explorer_trials: list[Mapping[str, Any]] = list(explorer["trials"])

    marks: dict[str, list[dict[str, Any]]] = {r.id: [] for r in fig.rows}
    trial_docs: dict[str, dict[str, Any]] = {}
    raw_sponsor: dict[str, str] = {}  # nct -> raw lead sponsor (or "Not given")
    targeted = 0
    for t in explorer_trials:
        nct = t["nct_id"]
        if "targeted" not in t.get("approaches", ()):
            continue  # spec §6.2: only Targeted trials get marks
        targeted += 1
        row = table.get(nct) or {}
        phases = list(row.get("phases") or ())
        columns = [COLUMN[p] for p in phases if p in COLUMN]
        if not columns:
            continue
        succeeded_by = list(t.get("succeeded_by", ()))
        placed = placements(list(t.get("drugs", ())), drug_mechanisms, fig, succeeded_by)
        if not placed:
            continue
        sponsor = (t.get("lead_sponsor") or "").strip() or _NOT_GIVEN
        raw_sponsor[nct] = sponsor
        for row_id, drug in placed.items():
            state, via = mark_state(t["outcome"], drug, succeeded_by)
            mark: dict[str, Any] = {
                "n": nct,
                "c": max(columns),
                "s": state,
                "y": t.get("start_year"),
                "y2": t.get("end_year"),
                "dz": _codes(t.get("condition_labels", ()), by_label),
                "drug": drug,
                "sp": sponsor,  # replaced by an index below
            }
            # Default-valued keys are omitted (readers treat absent as the default).
            if (sp := span(phases)) is not None:
                mark["span"] = sp
            if via is not None:
                mark["via"] = via
            if si := _codes(t.get("succeeded_in", ()), by_label):
                mark["si"] = si
            if t.get("end_estimated"):
                mark["est"] = True
            marks[row_id].append(mark)
        entry: dict[str, Any] = {"t": (t.get("title") or "")[:TITLE_MAX]}
        if t["outcome"] == "stopped":
            why = row.get("why_stopped")
            entry["why"] = why[:WHY_MAX] if why else None
            entry["r"] = reason_group(why, fig.reasons)
        trial_docs[nct] = entry

    marked = set(trial_docs)
    class_of_raw: dict[str, str | None] = {}
    for nct in sorted(marked):
        class_of_raw.setdefault(raw_sponsor[nct], (table.get(nct) or {}).get("sponsor_class"))
    sponsors: list[dict[str, Any]] = []
    index: dict[str, int] = {}
    for raw in sorted(class_of_raw):
        parent = parent_of(None if raw == _NOT_GIVEN else raw, class_of_raw[raw], fig.parents)
        index[raw] = len(sponsors)
        sponsors.append({"raw": raw, "parent": parent.parent, "kind": parent.kind})

    for row_marks in marks.values():
        for m in row_marks:
            m["sp"] = index[m["sp"]]
        row_marks.sort(key=lambda m: (m["y"] is None, m["y"] or 0, m["n"]))

    unlisted = unlisted_classes(explorer_trials, drug_mechanisms, fig)
    if unlisted:
        warnings.append(f"pipeline_unlisted_classes: {_join(unlisted)}")
    per_sponsor: dict[str, set[str]] = defaultdict(set)
    first_raw: dict[str, str] = {}
    for nct in sorted(marked):
        raw = raw_sponsor[nct]
        if raw == _NOT_GIVEN:
            continue
        display = norm_sponsor(sponsor_display(raw))
        if norm_sponsor(raw) in fig.parents or display in fig.parents:
            continue
        if sponsors[index[raw]]["kind"] != "industry":
            continue
        first_raw.setdefault(display, raw)
        per_sponsor[display].add(nct)
    unlisted_sponsors = sorted(
        ((first_raw[k], len(v)) for k, v in per_sponsor.items() if len(v) >= UNLISTED_SPONSOR_MIN),
        key=lambda rn: (-rn[1], rn[0]),
    )
    if unlisted_sponsors:
        warnings.append(f"pipeline_unlisted_sponsors: {_join(unlisted_sponsors)}")

    unrowed_counts: dict[str, set[str]] = defaultdict(set)
    for t in explorer_trials:
        if t["nct_id"] in marked or "targeted" not in t.get("approaches", ()):
            continue
        for d in t.get("drugs", ()):
            for cls in drug_mechanisms.get(d, ()):
                if cls in fig.unrowed:
                    unrowed_counts[cls].add(t["nct_id"])

    approved = _approved_cells(approvals, set(marks), {c.code for c in coded if c.code}, warnings)
    ap_by_row: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for (row_id, code), entries in approved.items():
        ap_by_row.setdefault(row_id, {})[code] = entries

    return {
        "generated_for": day.isoformat(),
        "diseases": diseases,
        "counts": {
            "trials": len(explorer_trials),
            "targeted": targeted,
            "in_rows": len(marked),
            "targeted_not_rowed": targeted - len(marked),
        },
        "families": [{"id": f.id, "label": f.label, "order": f.order} for f in fig.families],
        "rows": [
            {
                "id": r.id,
                "label": r.label,
                "sub": r.sub,
                "family": r.family,
                "order": r.order,
                "gene": r.gene,
                "blurb": r.blurb,
                "related": list(r.related),
                "marks": marks[r.id],
                **({"ap": ap_by_row[r.id]} if r.id in ap_by_row else {}),
            }
            for r in fig.rows
        ],
        "sponsors": sponsors,
        "trials": trial_docs,
        "unrowed": [
            {"class": c, "trials": len(n), "reason": fig.unrowed[c]}
            for c, n in sorted(unrowed_counts.items(), key=lambda cn: (-len(cn[1]), cn[0]))
        ],
    }
