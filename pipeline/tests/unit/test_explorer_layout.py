import logging

import numpy as np
import pytest
import scipy.sparse as sp

from trialradar.explorer.features import Features
from trialradar.explorer.layout import align, embed


def _features(x: np.ndarray) -> Features:
    n = x.shape[0]
    return Features(
        ids=[f"NCT{i:08d}" for i in range(n)],
        matrix=sp.csr_matrix(x),
        block_slices={"all": slice(0, x.shape[1])},
    )


def test_embed_shape_and_scale() -> None:
    rng = np.random.default_rng(0)
    a = np.hstack([rng.random((20, 10)) + 1.0, np.zeros((20, 10))])
    b = np.hstack([np.zeros((20, 10)), rng.random((20, 10)) + 1.0])
    out = embed(_features(np.vstack([a, b])), n_neighbors=10, min_dist=0.1, seed=7)
    assert out.shape == (40, 3)
    assert out.dtype == np.float64
    assert abs(np.linalg.norm(out, axis=1).max() - 1.0) < 1e-9
    assert np.linalg.norm(out[:20].mean(axis=0) - out[20:].mean(axis=0)) > 0.5


def test_embed_tiny_input() -> None:
    x = np.eye(3)
    out = embed(_features(x), n_neighbors=10, min_dist=0.1, seed=1)
    assert out.shape == (3, 3)
    assert not out.any()


def test_align_recovers_rotation() -> None:
    rng = np.random.default_rng(1)
    orig = rng.normal(size=(30, 3))
    q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
    q[:, 0] *= -1 if np.linalg.det(q) > 0 else 1  # force a reflection
    moved = 0.7 * orig @ q + np.array([1.0, -2.0, 3.0])
    ids = [f"t{i}" for i in range(30)]
    previous = {i: (float(p[0]), float(p[1]), float(p[2])) for i, p in zip(ids, orig, strict=True)}
    out = align(ids, moved, previous)
    assert np.abs(out - orig).max() < 1e-6


def test_align_applies_to_rows_without_previous() -> None:
    rng = np.random.default_rng(2)
    orig = rng.normal(size=(10, 3))
    moved = orig * 2.0 + 5.0
    ids = [f"t{i}" for i in range(10)]
    previous = {i: tuple(map(float, p)) for i, p in zip(ids[:6], orig[:6], strict=True)}
    out = align(ids, moved, previous)  # type: ignore[arg-type]
    assert np.abs(out - orig).max() < 1e-6


def test_align_without_overlap_is_identity() -> None:
    coords = np.random.default_rng(3).normal(size=(8, 3))
    ids = [f"t{i}" for i in range(8)]
    out = align(ids, coords, {"other": (0.0, 0.0, 0.0)})
    assert np.array_equal(out, coords)


@pytest.mark.parametrize("n", [4, 5, 10])
def test_embed_small_inputs_are_quiet(n: int, caplog: pytest.LogCaptureFixture) -> None:
    x = np.random.default_rng(n).random((n, 6))
    with caplog.at_level(logging.WARNING, logger="trialradar.explorer.layout"):
        out = embed(_features(x), n_neighbors=15, min_dist=0.1, seed=3)
    assert caplog.records == []
    assert out.shape == (n, 3)
    assert np.isfinite(out).all()


def test_embed_degenerate_rows_are_safe() -> None:
    out = embed(_features(np.ones((11, 5))), n_neighbors=15, min_dist=0.1, seed=3)
    assert out.shape == (11, 3)
    assert np.isfinite(out).all()


def test_align_nonfinite_previous_is_unchanged() -> None:
    coords = np.random.default_rng(5).normal(size=(8, 3))
    ids = [f"t{i}" for i in range(8)]
    previous = {i: (1.0, 2.0, 3.0) for i in ids}
    previous["t0"] = (float("nan"), 0.0, 0.0)
    assert np.array_equal(align(ids, coords, previous), coords)


def test_align_zero_previous_is_unchanged() -> None:
    coords = np.random.default_rng(4).normal(size=(8, 3))
    ids = [f"t{i}" for i in range(8)]
    out = align(ids, coords, {i: (0.0, 0.0, 0.0) for i in ids})
    assert np.array_equal(out, coords)


def test_embed_failure_reports_a_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    import umap

    def broken(self: object, *args: object, **kwargs: object) -> None:
        raise ValueError("no layout")

    monkeypatch.setattr(umap.UMAP, "fit_transform", broken)
    sink: list[str] = []
    x = np.random.default_rng(3).random((20, 5))
    out = embed(_features(x), n_neighbors=10, min_dist=0.1, seed=1, warnings=sink)
    assert not out.any()
    assert len(sink) == 1 and sink[0].startswith("explorer_layout_fallback: ")


def test_embed_success_reports_no_warning() -> None:
    sink: list[str] = []
    x = np.random.default_rng(4).random((20, 5))
    embed(_features(x), n_neighbors=10, min_dist=0.1, seed=1, warnings=sink)
    assert sink == []
