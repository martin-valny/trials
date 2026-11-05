import numpy as np
import scipy.sparse as sp
from sklearn.preprocessing import normalize

from trialradar.explorer.stats import _neighbour_lists, neighbourhood_lift

N, D = 200, 20


def _run(x, succeeded, drugs, **kw: int):
    ids = [f"T{i}" for i in range(len(x))]
    m = sp.csr_matrix(normalize(x))
    args = {"k": 10, "permutations": 300, "seed": 0, "min_successes": 30}
    args.update(kw)
    return neighbourhood_lift(m, ids, succeeded, [True] * len(ids), drugs, **args)


def _unique_drugs(n):
    return {f"T{i}": frozenset({f"d{i}"}) for i in range(n)}


def test_planted_cluster_is_clustered():
    rng = np.random.default_rng(1)
    x = rng.normal(size=(N, D))
    x[:40] = 5 * np.ones(D) + 0.1 * rng.normal(size=(40, D))
    s = [i < 40 for i in range(N)]
    r = _run(x, s, _unique_drugs(N))
    assert r.verdict == "clustered"
    assert r.lift is not None and r.lift > 1.5
    assert r.n_pool == N and r.n_succeeded == 40
    assert r.success_rate == 0.2
    assert r.baseline_range is not None and r.baseline_range[1] < r.lift


def test_random_labels_are_chance():
    rng = np.random.default_rng(2)
    x = rng.normal(size=(N, D))
    s = list(rng.random(N) < 0.25)
    r = _run(x, s, _unique_drugs(N), min_successes=10)
    assert r.verdict == "chance"


def test_same_drug_neighbours_excluded():
    rng = np.random.default_rng(3)
    x = rng.normal(size=(N, D))
    x[:40] = 5 * np.ones(D) + 0.1 * rng.normal(size=(40, D))
    s = [i < 40 for i in range(N)]
    drugs = _unique_drugs(N)
    for i in range(40):
        drugs[f"T{i}"] = frozenset({"shared"})
    r = _run(x, s, drugs)
    assert r.verdict == "chance"
    assert r.lift is not None and r.lift < 0.05
    assert r.n_averaged == 40 and r.n_short == 0
    idx, mask = _neighbour_lists(
        sp.csr_matrix(normalize(x)), [f"T{i}" for i in range(N)], drugs, 10
    )
    assert (mask[:40].sum(axis=1) == 10).all()
    assert (idx[:40][mask[:40]] >= 40).all()


def test_insufficient_below_min():
    rng = np.random.default_rng(4)
    x = rng.normal(size=(N, D))
    s = [i < 29 for i in range(N)]
    r = _run(x, s, _unique_drugs(N))
    assert r.verdict == "insufficient"
    assert r.lift is None and r.baseline_mean is None and r.baseline_range is None


def test_deterministic_with_seed():
    rng = np.random.default_rng(5)
    x = rng.normal(size=(N, D))
    s = list(rng.random(N) < 0.3)
    a = _run(x, s, _unique_drugs(N), seed=7)
    b = _run(x, s, _unique_drugs(N), seed=7)
    assert a == b


def test_pool_restricts_rows_and_zero_rows_have_no_neighbours():
    rng = np.random.default_rng(6)
    x = rng.normal(size=(60, D))
    x[5] = 0
    ids = [f"T{i}" for i in range(60)]
    pool = [i >= 5 for i in range(60)]
    s = [i % 2 == 0 for i in range(60)]
    r = neighbourhood_lift(
        sp.csr_matrix(x),
        ids,
        s,
        pool,
        _unique_drugs(60),
        k=5,
        permutations=50,
        seed=0,
        min_successes=5,
    )
    assert r.n_pool == 55
    assert r.n_succeeded == sum(s[5:])
    assert r.success_rate == r.n_succeeded / 55
    pid = [f"T{i}" for i in range(5, 60)]
    _, mask = _neighbour_lists(sp.csr_matrix(x[5:]), pid, _unique_drugs(60), 5)
    assert not mask[0].any()
    assert mask[1:].all()


def test_dense_same_drug_cluster_still_gets_k_neighbours():
    rng = np.random.default_rng(8)
    x = rng.normal(size=(500, D))
    x[:100] = 5 * np.ones(D) + 0.1 * rng.normal(size=(100, D))
    drugs = _unique_drugs(500)
    for i in range(100):
        drugs[f"T{i}"] = frozenset({"P"})
    idx, mask = _neighbour_lists(
        sp.csr_matrix(normalize(x)), [f"T{i}" for i in range(500)], drugs, 10
    )
    assert (mask[:100].sum(axis=1) == 10).all()
    assert (idx[:100] >= 100).all()


def test_self_is_never_a_neighbour_with_duplicate_rows():
    x = np.ones((6, 3))
    idx, mask = _neighbour_lists(sp.csr_matrix(normalize(x)), [f"T{i}" for i in range(6)], {}, 3)
    assert mask.all()
    for i in range(6):
        assert i not in idx[i]


def test_zero_success_rate_is_insufficient():
    x = np.random.default_rng(9).normal(size=(40, D))
    r = _run(x, [False] * 40, _unique_drugs(40), min_successes=0)
    assert r.verdict == "insufficient" and r.lift is None and r.success_rate == 0.0


def test_no_succeeded_row_with_neighbour_is_insufficient():
    x = np.random.default_rng(10).normal(size=(40, D))
    x[:5] = 0
    s = [i < 5 for i in range(40)]
    r = _run(x, s, _unique_drugs(40), min_successes=1)
    assert r.verdict == "insufficient" and r.n_averaged == 0 and r.n_short == 5


def test_permutations_must_be_positive():
    import pytest

    x = np.random.default_rng(11).normal(size=(40, D))
    with pytest.raises(ValueError):
        _run(x, [i < 10 for i in range(40)], _unique_drugs(40), permutations=0, min_successes=1)
