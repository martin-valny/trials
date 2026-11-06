"""Neighbourhood lift: do succeeded trials have succeeded neighbours beyond chance?

Same-drug neighbours are dropped: the success label is defined through drugs and
the features include drugs, so they would inflate the signal. The verdict is a
one-sided permutation test: "clustered" only when p < ``ALPHA``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt
import scipy.sparse as sp

from trialradar.explorer.outcomes import TrialDrugs

_CHUNK = 100
_CHUNK_ROWS = 512
ALPHA = 0.025  # one-sided: the lift must beat shuffled labels this rarely by chance
_TIE = 1e-12  # a shuffle within float error of the observed lift counts as reaching it


@dataclass(frozen=True)
class LiftResult:
    verdict: Literal["insufficient", "chance", "clustered"]
    lift: float | None
    baseline_mean: float | None
    baseline_range: tuple[float, float] | None
    n_pool: int
    n_succeeded: int
    success_rate: float | None
    n_averaged: int = 0  # succeeded rows with >= 1 kept neighbour (they form the average)
    n_short: int = 0  # succeeded rows with fewer than k kept neighbours (incl. none)
    p_value: float | None = None  # (1 + #{shuffled lift >= observed}) / (1 + #valid shuffles)


def _neighbour_lists(
    matrix: sp.csr_matrix, pool_ids: list[str], drugs: TrialDrugs, k: int
) -> tuple[npt.NDArray[np.int64], npt.NDArray[np.bool_]]:
    """Exact neighbour lists: index matrix (n, k) into pool rows plus a validity mask.

    For each row, every other non-zero pool row is ordered by cosine distance (ties by
    index) and the first k that are not the row itself and share no drug are kept.
    Zero rows have no neighbours and are never candidates.
    """
    n = matrix.shape[0]
    idx = np.zeros((n, k), dtype=np.int64)
    mask = np.zeros((n, k), dtype=bool)
    norms = np.asarray(abs(matrix).sum(axis=1)).ravel()
    nz = np.flatnonzero(norms > 0)
    if len(nz) < 2:
        return idx, mask
    sub = sp.csr_matrix(matrix[nz])
    sub_t = sub.T.tocsc()
    dsets = [drugs.get(pool_ids[int(i)], frozenset()) for i in nz]
    for lo in range(0, len(nz), _CHUNK_ROWS):
        hi = min(lo + _CHUNK_ROWS, len(nz))
        dist = 1.0 - (sub[lo:hi] @ sub_t).toarray()
        for r in range(lo, hi):
            order = np.argsort(dist[r - lo], kind="stable")
            me = int(nz[r])
            mine = dsets[r]
            kept = 0
            for c in order:
                c = int(c)
                if c == r:
                    continue
                if mine and mine & dsets[c]:
                    continue
                idx[me, kept] = int(nz[c])
                mask[me, kept] = True
                kept += 1
                if kept == k:
                    break
    return idx, mask


def _lifts(
    labels: npt.NDArray[np.bool_],
    idx: npt.NDArray[np.int64],
    mask: npt.NDArray[np.bool_],
    rate: float,
) -> npt.NDArray[np.float64]:
    """Lift for each label vector (rows of `labels`) over fixed neighbour lists."""
    cnt = mask.sum(axis=1)
    has = cnt > 0
    safe = np.where(has, cnt, 1)
    out = np.empty(labels.shape[0])
    for lo in range(0, labels.shape[0], _CHUNK):
        lab = labels[lo : lo + _CHUNK]
        share = (lab[:, idx] & mask).sum(axis=2) / safe
        sel = lab & has
        n_sel = sel.sum(axis=1)
        tot = (share * sel).sum(axis=1)
        out[lo : lo + _CHUNK] = np.where(n_sel > 0, tot / np.maximum(n_sel, 1), np.nan) / rate
    return out


def neighbourhood_lift(
    matrix: sp.csr_matrix,
    ids: Sequence[str],
    succeeded: Sequence[bool],
    pool: Sequence[bool],
    drugs: TrialDrugs,
    k: int,
    permutations: int,
    seed: int,
    min_successes: int,
) -> LiftResult:
    """Lift of neighbour success over the pool success rate, with a permutation null.

    Rows are L2-normalised here, so neighbours are by cosine distance whatever the
    caller passes (zero rows stay zero and get no neighbours). The verdict is
    "clustered" when the one-sided permutation p-value is below ``ALPHA``, else
    "chance". ``baseline_range`` (2.5-97.5 percentile of the shuffled lifts) is for
    display only. The null mean sits slightly below 1 by construction: a succeeded
    row's neighbours exclude itself, so the remaining pool has a marginally lower
    success rate.
    """
    if permutations < 1:
        raise ValueError("permutations must be >= 1")
    rows = np.flatnonzero(np.asarray(pool, dtype=bool))
    n_pool = len(rows)
    lab = np.asarray(succeeded, dtype=bool)[rows]
    n_succ = int(lab.sum())
    rate = n_succ / n_pool if n_pool else None
    if n_succ < min_successes or not rate:
        return LiftResult("insufficient", None, None, None, n_pool, n_succ, rate)

    pool_ids = [ids[int(i)] for i in rows]
    sub = sp.csr_matrix(matrix[rows], dtype=np.float64)
    norms = np.sqrt(np.asarray(sub.multiply(sub).sum(axis=1)).ravel())
    unit = sp.csr_matrix(
        sp.diags(np.where(norms > 0, 1.0 / np.where(norms > 0, norms, 1.0), 0.0)) @ sub
    )
    idx, mask = _neighbour_lists(unit, pool_ids, drugs, k)
    cnt = mask.sum(axis=1)
    n_avg = int((lab & (cnt > 0)).sum())
    n_short = int((lab & (cnt < k)).sum())
    observed = float(_lifts(lab[None, :], idx, mask, rate)[0])
    rng = np.random.default_rng(seed)
    parts = []
    for lo in range(0, permutations, _CHUNK):
        perm = np.stack([rng.permutation(lab) for _ in range(min(_CHUNK, permutations - lo))])
        parts.append(_lifts(perm, idx, mask, rate))
    base = np.concatenate(parts)
    base = base[~np.isnan(base)]
    if np.isnan(observed) or len(base) == 0:
        return LiftResult("insufficient", None, None, None, n_pool, n_succ, rate, n_avg, n_short)
    lo_b, hi_b = (float(v) for v in np.percentile(base, [2.5, 97.5]))
    p_value = (1 + int((base >= observed - _TIE).sum())) / (1 + len(base))
    # One-sided: a lift below the shuffles is not evidence of clustering either.
    verdict: Literal["chance", "clustered"] = "clustered" if p_value < ALPHA else "chance"
    return LiftResult(
        verdict,
        observed,
        float(base.mean()),
        (lo_b, hi_b),
        n_pool,
        n_succ,
        rate,
        n_avg,
        n_short,
        p_value,
    )
