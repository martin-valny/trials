"""Neighbourhood lift: do succeeded trials have succeeded neighbours beyond chance?

Same-drug neighbours are dropped: the success label is defined through drugs and
the features include drugs, so they would inflate the signal.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt
import scipy.sparse as sp
from sklearn.neighbors import NearestNeighbors

from trialradar.explorer.outcomes import TrialDrugs

_EXTRA_FACTOR = 5
_CHUNK = 100


@dataclass(frozen=True)
class LiftResult:
    verdict: Literal["insufficient", "chance", "clustered"]
    lift: float | None
    baseline_mean: float | None
    baseline_range: tuple[float, float] | None
    n_pool: int
    n_succeeded: int
    success_rate: float | None


def _neighbour_lists(
    matrix: sp.csr_matrix, pool_ids: list[str], drugs: TrialDrugs, k: int
) -> tuple[npt.NDArray[np.int64], npt.NDArray[np.bool_]]:
    """Index matrix (n, k) into pool rows plus a validity mask. Zero rows get none."""
    n = matrix.shape[0]
    idx = np.zeros((n, k), dtype=np.int64)
    mask = np.zeros((n, k), dtype=bool)
    norms = np.asarray(abs(matrix).sum(axis=1)).ravel()
    nz = np.flatnonzero(norms > 0)
    if len(nz) < 2:
        return idx, mask
    sub = matrix[nz]
    n_cand = min(len(nz), k + k * _EXTRA_FACTOR + 1)
    nn = NearestNeighbors(n_neighbors=n_cand, metric="cosine", algorithm="brute").fit(sub)
    cand = nn.kneighbors(sub, return_distance=False)
    for r, row in enumerate(cand):
        me = int(nz[r])
        mine = drugs.get(pool_ids[me], frozenset())
        kept = 0
        for c in row:
            j = int(nz[c])
            if j == me:
                continue
            if mine and mine & drugs.get(pool_ids[j], frozenset()):
                continue
            idx[me, kept] = j
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
    rows = np.flatnonzero(np.asarray(pool, dtype=bool))
    n_pool = len(rows)
    lab = np.asarray(succeeded, dtype=bool)[rows]
    n_succ = int(lab.sum())
    rate = n_succ / n_pool if n_pool else None
    if n_succ < min_successes or not rate:
        return LiftResult("insufficient", None, None, None, n_pool, n_succ, rate)

    pool_ids = [ids[int(i)] for i in rows]
    idx, mask = _neighbour_lists(sp.csr_matrix(matrix[rows]), pool_ids, drugs, k)
    observed = float(_lifts(lab[None, :], idx, mask, rate)[0])
    if np.isnan(observed):
        return LiftResult("insufficient", None, None, None, n_pool, n_succ, rate)

    rng = np.random.default_rng(seed)
    perm = np.stack([rng.permutation(lab) for _ in range(permutations)])
    base = _lifts(perm, idx, mask, rate)
    base = base[~np.isnan(base)]
    lo, hi = (float(v) for v in np.percentile(base, [2.5, 97.5]))
    # Only a lift above the range counts as clustering; below it is not evidence of it.
    verdict: Literal["chance", "clustered"] = "clustered" if observed > hi else "chance"
    return LiftResult(verdict, observed, float(base.mean()), (lo, hi), n_pool, n_succ, rate)
