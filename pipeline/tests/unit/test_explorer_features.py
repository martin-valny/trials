import inspect
from dataclasses import replace

import numpy as np
import pytest

from trialradar.explorer.extras import StudyExtras
from trialradar.explorer.features import build_features
from trialradar.explorer.mechanisms import TrialMechanisms

W = {"disease": 1.0, "treatment_type": 1.0, "molecule": 1.0, "mechanism": 1.0, "population": 1.0}


def _x(nct: str, **kw: object) -> StudyExtras:
    base = StudyExtras(
        nct_id=nct,
        brief_summary=None,
        sex="ALL",
        min_age_years=18.0,
        max_age_years=65.0,
        has_results=False,
        experimental_drugs=(),
        mesh_terms=("Asthma",),
        condition_labels=("asthma",),
    )
    return replace(base, **kw)  # type: ignore[arg-type]


def _build(extras: dict[str, StudyExtras], drugs: dict[str, frozenset[str]], w=W, mechs=None):  # type: ignore[no-untyped-def]
    ids = sorted(extras)
    types = {i: frozenset({"DRUG"}) for i in ids}
    return build_features(ids, extras, drugs, types, w, mechs or {})


def _cos(m, i: int, j: int) -> float:  # type: ignore[no-untyped-def]
    a = m[i].toarray().ravel()
    b = m[j].toarray().ravel()
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


def test_signature_has_no_outcome_inputs() -> None:
    params = set(inspect.signature(build_features).parameters)
    assert params == {"ids", "extras", "drugs", "intervention_types", "weights", "mechanisms"}
    ex = {"NCT1": _x("NCT1"), "NCT2": _x("NCT2")}
    drugs = {"NCT1": frozenset({"a"}), "NCT2": frozenset({"b"})}
    a = _build(ex, drugs)
    flipped = {k: replace(v, has_results=True) for k, v in ex.items()}
    b = _build(flipped, drugs)
    assert (a.matrix != b.matrix).nnz == 0


def test_same_drug_trials_are_closer() -> None:
    ex = {f"NCT{i}": _x(f"NCT{i}") for i in (1, 2, 3)}
    drugs = {
        "NCT1": frozenset({"dupilumab"}),
        "NCT2": frozenset({"dupilumab"}),
        "NCT3": frozenset({"placebo2"}),
    }
    f = _build(ex, drugs)
    assert _cos(f.matrix, 0, 1) > _cos(f.matrix, 0, 2)


def test_zero_weight_removes_block_influence() -> None:
    ex = {"NCT1": _x("NCT1"), "NCT2": _x("NCT2")}
    drugs = {"NCT1": frozenset({"a"}), "NCT2": frozenset({"b"})}
    f = _build(ex, drugs, {**W, "molecule": 0.0})
    assert abs(_cos(f.matrix, 0, 1) - 1.0) < 1e-9


def test_null_eligibility_ok() -> None:
    ex = {
        "NCT1": _x("NCT1", min_age_years=None, max_age_years=None, sex=None, mesh_terms=()),
        "NCT2": _x("NCT2", mesh_terms=()),
    }
    f = _build(ex, {})
    assert np.isfinite(f.matrix.toarray()).all()
    assert f.matrix.shape[0] == 2
    assert f.block_slices["disease"].stop >= f.block_slices["disease"].start


def test_zero_ids() -> None:
    f = build_features([], {}, {}, {}, W, {})
    assert f.ids == []
    assert f.matrix.shape[0] == 0
    assert set(f.block_slices) == set(W)


def test_empty_disease_vocab_and_no_drugs() -> None:
    ex = {
        "NCT1": _x("NCT1", mesh_terms=(), condition_labels=()),
        "NCT2": _x("NCT2", mesh_terms=(), condition_labels=()),
    }
    f = _build(ex, {})
    s = f.block_slices
    assert s["disease"].stop == s["disease"].start
    assert s["molecule"].stop == s["molecule"].start
    assert np.isfinite(f.matrix.toarray()).all()


def _pop(**kw: object) -> list[float]:
    ex = {"NCT1": _x("NCT1", mesh_terms=(), condition_labels=(), **kw)}
    f = build_features(["NCT1"], ex, {}, {"NCT1": frozenset()}, {**W, "population": 1.0}, {})
    sl = f.block_slices["population"]
    row = f.matrix[0, sl.start : sl.stop].toarray().ravel()
    return [float(v > 0) for v in row]


def test_population_rules() -> None:
    # [paediatric, adult, older, female, male]
    assert _pop(min_age_years=6.0, max_age_years=17.0, sex=None) == [1, 0, 0, 0, 0]
    assert _pop(min_age_years=18.0, max_age_years=None, sex=None) == [0, 1, 1, 0, 0]
    assert _pop(min_age_years=None, max_age_years=None, sex=None) == [0, 1, 0, 0, 0]
    assert _pop(sex="FEMALE")[3:] == [1, 0]
    assert _pop(sex="MALE")[3:] == [0, 1]


def test_deterministic_under_shuffle() -> None:
    ex = {f"NCT{i}": _x(f"NCT{i}") for i in range(4)}
    drugs = {f"NCT{i}": frozenset({f"d{i % 2}"}) for i in range(4)}
    types = {i: frozenset({"DRUG"}) for i in ex}
    a = build_features(["NCT0", "NCT1", "NCT2", "NCT3"], ex, drugs, types, W, {})
    b = build_features(["NCT3", "NCT1", "NCT0", "NCT2"], ex, drugs, types, W, {})
    assert a.ids == b.ids
    assert a.block_slices == b.block_slices
    assert (a.matrix != b.matrix).nnz == 0


def test_missing_weight_raises() -> None:
    ex = {"NCT1": _x("NCT1")}
    with pytest.raises(KeyError, match="molecule"):
        build_features(
            ["NCT1"],
            ex,
            {},
            {},
            {"disease": 1.0, "treatment_type": 1.0, "population": 1.0, "mechanism": 1.0},
            {},
        )


def _mech_ids(
    ex: dict[str, StudyExtras],
    mechs: dict[str, TrialMechanisms],
    w=W,  # type: ignore[no-untyped-def]
):
    drugs = {k: frozenset({"d"}) for k in ex}  # same molecule everywhere
    return _build(ex, drugs, {**w, "disease": 0.0, "treatment_type": 0.0, "molecule": 0.0}, mechs)


def test_mechanism_block_groups_by_class_and_target() -> None:
    ex = {f"NCT{i}": _x(f"NCT{i}") for i in (1, 2, 3)}
    mechs = {
        "NCT1": TrialMechanisms(("S1P modulator",), ("S1PR1",), ("small_molecule",)),
        "NCT2": TrialMechanisms(("S1P modulator",), ("S1PR1",), ("small_molecule",)),
        "NCT3": TrialMechanisms(("anti-CD20",), ("MS4A1",), ("antibody",)),
    }
    f = _mech_ids(ex, mechs)
    sl = f.block_slices["mechanism"]
    assert sl.stop - sl.start == 4  # class:x2 + target:x2
    m = f.matrix[:, sl.start : sl.stop]
    assert m.shape == (3, 4)
    assert _cos(m, 0, 1) > 0.999
    assert _cos(m, 0, 2) < 0.01


def test_mechanism_block_zero_for_drug_free_trials() -> None:
    ex = {f"NCT{i}": _x(f"NCT{i}") for i in (1, 2)}
    mechs = {"NCT1": TrialMechanisms(("a",), ("T",), ("antibody",))}  # NCT2 absent
    f = _mech_ids(ex, mechs)
    sl = f.block_slices["mechanism"]
    row = f.matrix[1, sl.start : sl.stop].toarray().ravel()
    assert (row == 0).all()
    assert np.isfinite(f.matrix.toarray()).all()
    assert f.matrix[0, sl.start : sl.stop].nnz > 0


def test_mechanism_zero_weight_and_no_mapping() -> None:
    ex = {f"NCT{i}": _x(f"NCT{i}") for i in (1, 2)}
    mechs = {"NCT1": TrialMechanisms(("a",), ("T",)), "NCT2": TrialMechanisms(("b",), ("U",))}
    f = _build(ex, {}, {**W, "mechanism": 0.0}, mechs)
    assert (f.matrix[:, f.block_slices["mechanism"]].toarray() == 0).all()
    g = _build(ex, {}, W, {})
    sl = g.block_slices["mechanism"]
    assert sl.stop == sl.start


def test_mechanism_block_has_no_outcome_leakage() -> None:
    ex = {"NCT1": _x("NCT1"), "NCT2": _x("NCT2")}
    mechs = {"NCT1": TrialMechanisms(("a",), ("T",)), "NCT2": TrialMechanisms(("b",), ("U",))}
    a = _build(ex, {}, W, mechs)
    flipped = {k: replace(v, has_results=True) for k, v in ex.items()}
    b = _build(flipped, {}, W, mechs)
    assert (a.matrix != b.matrix).nnz == 0
    assert "outcome" not in inspect.signature(build_features).parameters
