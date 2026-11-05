import inspect
from dataclasses import replace

import numpy as np

from trialradar.explorer.extras import StudyExtras
from trialradar.explorer.features import build_features

W = {"disease": 1.0, "treatment_type": 1.0, "molecule": 1.0, "population": 1.0}


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


def _build(extras: dict[str, StudyExtras], drugs: dict[str, frozenset[str]], w=W):  # type: ignore[no-untyped-def]
    ids = sorted(extras)
    types = {i: frozenset({"DRUG"}) for i in ids}
    return build_features(ids, extras, drugs, types, w)


def _cos(m, i: int, j: int) -> float:  # type: ignore[no-untyped-def]
    a = m[i].toarray().ravel()
    b = m[j].toarray().ravel()
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


def test_signature_has_no_outcome_inputs() -> None:
    params = set(inspect.signature(build_features).parameters)
    assert params == {"ids", "extras", "drugs", "intervention_types", "weights"}
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
