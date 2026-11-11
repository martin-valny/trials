"""Named clusters on the explorer map: HDBSCAN on the 3D coordinates, rule-based names.

Names are built from the members' explorer trial dicts only (condition labels, drugs,
mechanism classes, intervention types); nothing is guessed. Ties are broken by name so
the output is deterministic."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from typing import Any, Literal

import numpy as np
from sklearn.cluster import HDBSCAN

from trialradar.config import ClusterConfig

MIXED = "Mixed"
_MIXED_DISEASES = "Mixed diseases"
_MIXED_MIDDLE = "mixed"
_DECIMALS = 4

Kind = Literal["mechanism", "type", "mixed"]

TYPE_WORDS: dict[str, str] = {
    "BEHAVIORAL": "behavioural",
    "DEVICE": "devices",
    "PROCEDURE": "procedures",
    "DIETARY_SUPPLEMENT": "supplements",
    "DIAGNOSTIC_TEST": "diagnostics",
    "RADIATION": "radiation",
    "GENETIC": "genetic",
    "BIOLOGICAL": "biologics",
    "DRUG": "drugs",
    "OTHER": "other interventions",
    "COMBINATION_PRODUCT": "combination products",
}


def find_clusters(coords: np.ndarray, cfg: ClusterConfig) -> np.ndarray:
    """HDBSCAN labels per row (-1 = noise). Fewer than ``min_cluster_size`` rows: all noise."""
    n = len(coords)
    if n < cfg.min_cluster_size:
        return np.full(n, -1, dtype=np.int64)
    model = HDBSCAN(
        min_cluster_size=cfg.min_cluster_size,
        min_samples=min(cfg.min_samples, n),
        copy=True,
    )
    return np.asarray(model.fit_predict(np.asarray(coords, dtype=np.float64)), dtype=np.int64)


def _ranked(counts: Counter[str]) -> list[tuple[str, int]]:
    """Most common first; equal counts in name order."""
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))


def _count_sets(rows: Iterable[Iterable[str]]) -> Counter[str]:
    """In how many rows each value appears (a value counts once per row)."""
    c: Counter[str] = Counter()
    for values in rows:
        c.update(set(values))
    return c


def _disease_part(
    members: Sequence[Mapping[str, Any]], shorts: Mapping[str, str], share: float
) -> str:
    n = len(members)
    first: Counter[str] = Counter(
        m["condition_labels"][0] for m in members if m.get("condition_labels")
    )
    ranked = _ranked(first)
    if not n or not ranked:
        return _MIXED_DISEASES
    (a, na), *rest = ranked
    if na / n >= share:
        return shorts.get(a, a)
    if rest:
        b, nb = rest[0]
        if (na + nb) / n >= share:
            return f"{shorts.get(a, a)} + {shorts.get(b, b)}"
    return _MIXED_DISEASES


def _middle_part(
    members: Sequence[Mapping[str, Any]], cfg: ClusterConfig
) -> tuple[str, Kind, str | None]:
    """The middle text, which branch named it, and the mechanism class when that branch did.

    The top mechanism class names the cluster only when it reaches ``mechanism_share`` of the
    drug-bearing members and its trials are at least ``mechanism_min_overall`` of all members,
    so a lone drug trial cannot name a cluster of non-drug trials."""
    with_drugs = [m for m in members if m.get("drugs")]
    if with_drugs:
        ranked = _ranked(_count_sets(m.get("mechanisms") or () for m in with_drugs))
        if (
            ranked
            and ranked[0][1] / len(with_drugs) >= cfg.mechanism_share
            and ranked[0][1] / len(members) >= cfg.mechanism_min_overall
        ):
            return ranked[0][0], "mechanism", ranked[0][0]
    if members:
        ranked = _ranked(_count_sets(m.get("treatment_types") or () for m in members))
        if ranked and ranked[0][1] / len(members) >= cfg.type_share:
            kind = ranked[0][0]
            return TYPE_WORDS.get(kind, kind.replace("_", " ").lower()), "type", None
    return _MIXED_MIDDLE, "mixed", None


def _drug_suffix(
    members: Sequence[Mapping[str, Any]], share: float, mechanism: str | None = None
) -> str:
    """The top drug, bracketed, when it reaches ``share`` of all members.

    With a ``mechanism`` the drug is ranked among the members carrying that class only, so a
    mechanism name never borrows a drug of another class; the share is still over all members."""
    pool = (
        members
        if mechanism is None
        else [m for m in members if mechanism in (m.get("mechanisms") or ())]
    )
    ranked = _ranked(_count_sets(m.get("drugs") or () for m in pool))
    if members and ranked and ranked[0][1] / len(members) >= share:
        return f" ({ranked[0][0]})"
    return ""


def name_and_kind(
    members: Sequence[Mapping[str, Any]], shorts: Mapping[str, str], cfg: ClusterConfig
) -> tuple[str, Kind]:
    """The cluster name (see ``name_cluster``) and its kind: ``"mechanism"``, ``"type"`` or
    ``"mixed"``, after the branch that named the middle part."""
    disease = _disease_part(members, shorts, cfg.disease_share)
    middle, kind, mechanism = _middle_part(members, cfg)
    if disease == _MIXED_DISEASES and kind == "mixed":
        return MIXED, kind
    return f"{disease} · {middle}{_drug_suffix(members, cfg.drug_share, mechanism)}", kind


def name_cluster(
    members: Sequence[Mapping[str, Any]], shorts: Mapping[str, str], cfg: ClusterConfig
) -> str:
    """``"<disease> · <mechanism or type>[ (<drug>)]"``; ``"Mixed"`` when both parts are mixed.

    ``members`` are explorer trial dicts; ``shorts`` maps a condition label to its short name.
    A mechanism-named cluster brackets its top drug among the members of that class."""
    return name_and_kind(members, shorts, cfg)[0]


def build_clusters(
    coords: np.ndarray,
    trials: Sequence[Mapping[str, Any]],
    shorts: Mapping[str, str],
    cfg: ClusterConfig,
) -> tuple[list[dict[str, Any]], list[int | None]]:
    """The ``clusters`` list and each trial's cluster id (None = noise), row-aligned with ``trials``.

    A cluster's anchor is the member nearest its coordinate-wise median, rounded like the
    trial coordinates. No clusters (too few rows or only noise) gives ``([], [None, ...])``."""
    coords = np.asarray(coords, dtype=np.float64)
    labels = find_clusters(coords, cfg)
    per_trial: list[int | None] = [int(lab) if lab >= 0 else None for lab in labels]
    clusters: list[dict[str, Any]] = []
    for cid in sorted({int(lab) for lab in labels if lab >= 0}):
        idx = np.flatnonzero(labels == cid)
        pts = coords[idx]
        anchor = pts[int(np.argmin(np.linalg.norm(pts - np.median(pts, axis=0), axis=1)))]
        label, kind = name_and_kind([trials[int(i)] for i in idx], shorts, cfg)
        clusters.append(
            {
                "id": cid,
                "label": label,
                "kind": kind,
                "n": len(idx),
                "x": round(float(anchor[0]), _DECIMALS),
                "y": round(float(anchor[1]), _DECIMALS),
                "z": round(float(anchor[2]), _DECIMALS),
            }
        )
    return clusters, per_trial
