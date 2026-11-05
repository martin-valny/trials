"""3D layout of the feature matrix and day-to-day alignment of the result."""

from __future__ import annotations

import warnings
from collections.abc import Mapping, Sequence

import numpy as np
from scipy.linalg import orthogonal_procrustes

from trialradar.explorer.features import Features

_MIN_POINTS = 4
_SPECTRAL_MIN = 16  # below this, spectral init warns or fails


def embed(features: Features, n_neighbors: int, min_dist: float, seed: int) -> np.ndarray:
    """UMAP to 3D, centred and scaled so the largest norm is 1."""
    n = features.matrix.shape[0]
    if n < _MIN_POINTS:
        return np.zeros((n, 3), dtype=np.float64)
    import umap  # heavy import; keep out of module load

    reducer = umap.UMAP(
        n_components=3,
        metric="cosine",
        n_neighbors=min(n_neighbors, n - 1),
        min_dist=min_dist,
        random_state=seed,
        n_jobs=1,
        init="spectral" if n >= _SPECTRAL_MIN else "random",
    )
    try:
        with warnings.catch_warnings(record=True):
            warnings.simplefilter("always")
            out = np.asarray(reducer.fit_transform(features.matrix), dtype=np.float64)
    except Exception:  # noqa: BLE001
        return np.zeros((n, 3), dtype=np.float64)
    if out.shape != (n, 3) or not np.isfinite(out).all():
        return np.zeros((n, 3), dtype=np.float64)
    out = out - out.mean(axis=0)
    peak = float(np.linalg.norm(out, axis=1).max())
    return out / peak if peak > 0 else out


def align(
    ids: Sequence[str],
    coords: np.ndarray,
    previous: Mapping[str, tuple[float, float, float]],
) -> np.ndarray:
    """Map coords onto the previous layout (rotation/reflection, uniform scale, shift)."""
    idx = [i for i, t in enumerate(ids) if t in previous]
    if len(idx) < _MIN_POINTS:
        return coords
    src = coords[idx]
    dst = np.array([previous[ids[i]] for i in idx], dtype=np.float64)
    if not (np.isfinite(src).all() and np.isfinite(dst).all()):
        return coords
    src_c, dst_c = src.mean(axis=0), dst.mean(axis=0)
    a, b = src - src_c, dst - dst_c
    denom = float((a**2).sum())
    if denom == 0.0:
        return coords
    rot, _ = orthogonal_procrustes(a, b)
    scale = float((a @ rot * b).sum()) / denom
    if not scale > 0:
        return coords
    return np.asarray((coords - src_c) @ rot * scale + dst_c, dtype=np.float64)
