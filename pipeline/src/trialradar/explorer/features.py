"""Content-only feature matrix for the explorer layout.

Inputs are deliberately limited to what a trial studies (conditions, MeSH terms,
intervention types, drugs, eligibility). Outcomes and results never enter.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np
import scipy.sparse as sp
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

from trialradar.explorer.extras import StudyExtras
from trialradar.explorer.outcomes import TrialDrugs

_BLOCKS = ("disease", "treatment_type", "molecule", "population")
_ADULT_LO, _ADULT_HI, _OLDER = 18.0, 65.0, 65.0


@dataclass(frozen=True)
class Features:
    ids: list[str]
    matrix: sp.csr_matrix
    block_slices: dict[str, slice]


def _multi_hot(rows: Sequence[Sequence[str]]) -> sp.csr_matrix:
    vocab = {t: i for i, t in enumerate(sorted({t for r in rows for t in r}))}
    data, ri, ci = [], [], []
    for r, toks in enumerate(rows):
        for t in set(toks):
            data.append(1.0)
            ri.append(r)
            ci.append(vocab[t])
    return sp.csr_matrix((data, (ri, ci)), shape=(len(rows), len(vocab)), dtype=np.float64)


def _tfidf(rows: Sequence[Sequence[str]]) -> sp.csr_matrix:
    if not any(rows):
        return sp.csr_matrix((len(rows), 0), dtype=np.float64)
    vec = TfidfVectorizer(analyzer=lambda x: x, norm=None)
    return sp.csr_matrix(vec.fit_transform([list(r) for r in rows]), dtype=np.float64)


def _population(x: StudyExtras) -> list[float]:
    lo, hi = x.min_age_years, x.max_age_years
    if lo is None and hi is None:
        return [0.0, 1.0, 0.0, *_sex(x)]
    lo_v = 0.0 if lo is None else lo
    hi_v = math.inf if hi is None else hi
    paediatric = lo_v < _ADULT_LO
    adult = lo_v < _ADULT_HI and hi_v >= _ADULT_LO
    older = hi is None or hi >= _OLDER
    return [float(paediatric), float(adult), float(older), *_sex(x)]


def _sex(x: StudyExtras) -> list[float]:
    return [float(x.sex == "FEMALE"), float(x.sex == "MALE")]


def _l2(m: sp.csr_matrix) -> sp.csr_matrix:
    # sklearn leaves all-zero rows as zero (no NaN) but rejects zero-width input.
    if m.shape[0] == 0 or m.shape[1] == 0:
        return m
    return sp.csr_matrix(normalize(m, norm="l2", axis=1))


def build_features(
    ids: Sequence[str],
    extras: Mapping[str, StudyExtras],
    drugs: TrialDrugs,
    intervention_types: Mapping[str, frozenset[str]],
    weights: Mapping[str, float],
) -> Features:
    missing = [k for k in _BLOCKS if k not in weights]
    if missing:
        raise KeyError(f"missing explorer weights: {missing}")
    ordered = sorted(ids)
    xs = [extras[i] for i in ordered]
    n = len(ordered)

    cond = _multi_hot([x.condition_labels for x in xs])
    mesh = _tfidf([x.mesh_terms for x in xs])
    blocks: dict[str, sp.csr_matrix] = {
        "disease": sp.hstack([_l2(cond), _l2(mesh)], format="csr")
        if cond.shape[1] or mesh.shape[1]
        else sp.csr_matrix((n, 0), dtype=np.float64),
        "treatment_type": _multi_hot([sorted(intervention_types.get(i, ())) for i in ordered]),
        "molecule": _tfidf([sorted(drugs.get(i, ())) for i in ordered]),
        "population": sp.csr_matrix(
            np.array([_population(x) for x in xs], dtype=np.float64).reshape(n, 5)
        ),
    }

    parts: list[sp.csr_matrix] = []
    slices: dict[str, slice] = {}
    start = 0
    for name in _BLOCKS:
        b = _l2(blocks[name]) * math.sqrt(max(weights.get(name, 0.0), 0.0))
        b = sp.csr_matrix(b)
        parts.append(b)
        slices[name] = slice(start, start + b.shape[1])
        start += b.shape[1]
    matrix = sp.csr_matrix(sp.hstack(parts, format="csr"), shape=(n, start))
    return Features(ids=ordered, matrix=matrix, block_slices=slices)
