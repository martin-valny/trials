"""Named clusters on the explorer map: HDBSCAN on the 3D coordinates plus rule-based names."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from trialradar.config import ClusterConfig
from trialradar.explorer.clusters import (
    build_clusters,
    find_clusters,
    name_and_kind,
    name_cluster,
)

CFG = ClusterConfig()
MS = "Multiple sclerosis"
SHORTS = {MS: "MS"}


def _blobs(seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    centres = np.array([[0.0, 0.0, 0.0], [20.0, 0.0, 0.0], [0.0, 20.0, 20.0]])
    pts = [c + rng.normal(scale=0.5, size=(40, 3)) for c in centres]
    outlier = np.array([[200.0, -200.0, 200.0]])
    coords = np.vstack([*pts, outlier])
    truth = np.repeat([0, 1, 2], 40)
    return coords, truth


def _trial(
    label: str | None = None,
    *,
    labels: list[str] | None = None,
    drugs: list[str] | None = None,
    mechanisms: list[str] | None = None,
    types: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "condition_labels": labels if labels is not None else ([label] if label else []),
        "drugs": drugs or [],
        "mechanisms": mechanisms or [],
        "treatment_types": types or [],
    }


# --- find_clusters -------------------------------------------------------------------


def test_three_blobs_give_three_clusters_and_noise() -> None:
    coords, truth = _blobs()
    labels = find_clusters(coords, CFG)
    assert labels.shape == (len(coords),)
    assert len(set(labels[:-1].tolist()) - {-1}) == 3
    # each blob maps onto exactly one cluster
    for blob in range(3):
        got = set(labels[:-1][truth == blob].tolist()) - {-1}
        assert len(got) == 1
    assert labels[-1] == -1


def test_fewer_rows_than_min_cluster_size_is_all_noise() -> None:
    coords = np.zeros((CFG.min_cluster_size - 1, 3))
    assert (find_clusters(coords, CFG) == -1).all()
    assert find_clusters(np.zeros((0, 3)), CFG).shape == (0,)


# --- build_clusters ------------------------------------------------------------------


def test_build_clusters_lists_clusters_and_nulls_noise() -> None:
    coords, _ = _blobs()
    trials = [_trial(MS, types=["BEHAVIORAL"]) for _ in range(len(coords))]
    clusters, per_trial = build_clusters(coords, trials, SHORTS, CFG)
    assert len(clusters) == 3
    assert [c["id"] for c in clusters] == sorted(c["id"] for c in clusters)
    assert per_trial[-1] is None
    assert sum(c["n"] for c in clusters) == sum(p is not None for p in per_trial)
    for c in clusters:
        assert set(c) == {"id", "label", "kind", "n", "x", "y", "z"}
        assert c["label"] == "MS · behavioural"
        assert c["kind"] == "type"
        assert c["n"] == sum(p == c["id"] for p in per_trial)


def test_anchor_is_the_member_nearest_the_median() -> None:
    coords, _ = _blobs()
    trials = [_trial() for _ in range(len(coords))]
    clusters, per_trial = build_clusters(coords, trials, {}, CFG)
    for c in clusters:
        idx = [i for i, p in enumerate(per_trial) if p == c["id"]]
        members = coords[idx]
        anchor = (c["x"], c["y"], c["z"])
        rounded = [tuple(round(float(v), 4) for v in row) for row in members]
        assert anchor in rounded  # the anchor is a member, rounded like the trial coords
        med = np.median(members, axis=0)
        best = members[np.argmin(np.linalg.norm(members - med, axis=1))]
        assert anchor == tuple(round(float(v), 4) for v in best)


def test_too_few_rows_gives_no_clusters_and_null_everywhere() -> None:
    """Review Focus 4: no clusters → ``clusters == []`` and every ``cluster`` is null."""
    coords = np.arange(30, dtype=float).reshape(10, 3)
    clusters, per_trial = build_clusters(coords, [_trial() for _ in range(10)], {}, CFG)
    assert clusters == []
    assert per_trial == [None] * 10


def test_only_noise_gives_no_clusters() -> None:
    """With exactly ``min_cluster_size`` rows no split can survive and HDBSCAN does not
    select the single root cluster, so everything is noise (Review Focus 4)."""
    rng = np.random.default_rng(1)
    coords = rng.uniform(-1000, 1000, size=(CFG.min_cluster_size, 3))
    clusters, per_trial = build_clusters(coords, [_trial() for _ in coords], {}, CFG)
    assert clusters == []
    assert per_trial == [None] * len(coords)


# --- name_cluster --------------------------------------------------------------------


def test_name_disease_short_mechanism_and_drug() -> None:
    members = [
        _trial(MS, drugs=["ocrelizumab"], mechanisms=["anti-CD20"], types=["DRUG"])
        for _ in range(6)
    ] + [
        _trial(MS, drugs=["other"], mechanisms=["S1P modulator"], types=["DRUG"]),
        _trial("Disease B", types=["BEHAVIORAL"]),
    ]
    assert name_cluster(members, SHORTS, CFG) == "MS · anti-CD20 (ocrelizumab)"


def test_name_falls_back_to_the_label_without_a_short() -> None:
    members = [_trial("Disease C", types=["DEVICE"]) for _ in range(5)]
    assert name_cluster(members, SHORTS, CFG) == "Disease C · devices"


def test_name_intervention_type_plural() -> None:
    members = [_trial(MS, types=["BEHAVIORAL"]) for _ in range(6)] + [
        _trial(MS, drugs=["x"], types=["DRUG"]),
        _trial(MS, drugs=["y"], types=["DRUG"]),
    ]
    # x and y are each 1/8 < drug_share: no suffix
    assert name_cluster(members, SHORTS, CFG) == "MS · behavioural"


@pytest.mark.parametrize(
    ("kind", "word"),
    [
        ("BEHAVIORAL", "behavioural"),
        ("DEVICE", "devices"),
        ("PROCEDURE", "procedures"),
        ("DIETARY_SUPPLEMENT", "supplements"),
        ("DIAGNOSTIC_TEST", "diagnostics"),
        ("RADIATION", "radiation"),
        ("GENETIC", "genetic"),
        ("BIOLOGICAL", "biologics"),
        ("DRUG", "drugs"),
        ("OTHER", "other interventions"),
        ("COMBINATION_PRODUCT", "combination products"),
    ],
)
def test_every_type_word(kind: str, word: str) -> None:
    assert name_cluster([_trial(MS, types=[kind])], SHORTS, CFG) == f"MS · {word}"


def test_name_top_two_diseases_and_mixed_middle() -> None:
    members = (
        [_trial("NMOSD", drugs=[f"n{i}"], mechanisms=[f"m{i}"], types=["DRUG"]) for i in range(4)]
        + [_trial("CIDP", types=["BEHAVIORAL"]) for _ in range(3)]
        + [_trial("Disease Q", types=["DEVICE"]), _trial("Disease R", types=["PROCEDURE"])]
    )
    # N 4/9 < 0.6; N+P 7/9 ≥ 0.6. Drug-bearing: 4 distinct mechanisms (1/4 each). Types: DRUG 4/9.
    assert name_cluster(members, {}, CFG) == "NMOSD + CIDP · mixed"


def test_name_both_parts_mixed_is_mixed() -> None:
    """Review Focus 5: never an empty label; both parts mixed → "Mixed"."""
    members = [
        _trial(f"Disease {i}", drugs=[f"d{i}"], mechanisms=[f"m{i}"], types=[t])
        for i, t in enumerate(["DRUG", "DEVICE", "BEHAVIORAL", "PROCEDURE", "RADIATION", "OTHER"])
    ]
    assert name_cluster(members, {}, CFG) == "Mixed"


def test_name_uses_only_the_first_condition_label() -> None:
    members = [_trial(labels=[MS, "Disease B"], types=["DEVICE"]) for _ in range(3)]
    assert name_cluster(members, SHORTS, CFG) == "MS · devices"


def test_name_of_unlabelled_members_is_never_empty() -> None:
    assert name_cluster([_trial()], {}, CFG) == "Mixed"
    assert name_cluster([], {}, CFG) == "Mixed"


def test_mechanism_share_is_among_drug_bearing_members_only() -> None:
    members = [
        _trial(MS, drugs=["d1"], mechanisms=["anti-CD20"], types=["DRUG"]),
        _trial(MS, drugs=["d2"], mechanisms=["anti-CD20"], types=["DRUG"]),
        _trial(MS, drugs=["d3"], mechanisms=["other"], types=["DRUG"]),
    ] + [_trial(MS, types=["BEHAVIORAL"]) for _ in range(5)]
    # 2/3 of drug-bearing members → anti-CD20 (only 2/8 of all members)
    assert name_cluster(members, SHORTS, CFG) == "MS · anti-CD20"


def test_drug_suffix_needs_drug_share() -> None:
    members = [_trial(MS, drugs=["alpha"], types=["DRUG"])] + [
        _trial(MS, drugs=[f"z{i}"], types=["DRUG"]) for i in range(5)
    ]
    # alpha 1/6 ≥ 0.15 → suffix; ties broken by name, so "alpha" wins
    assert name_cluster(members, SHORTS, CFG) == "MS · drugs (alpha)"
    tight = CFG.model_copy(update={"drug_share": 0.5})
    assert name_cluster(members, SHORTS, tight) == "MS · drugs"


def test_mechanism_drug_is_the_top_drug_within_the_class() -> None:
    """Regression: the bracketed drug comes from members carrying the named class, not the
    cluster's overall top drug (which here belongs to another class)."""
    members = (
        [_trial(MS, drugs=["a1"], mechanisms=["class A"], types=["DRUG"]) for _ in range(3)]
        + [_trial(MS, drugs=["a2"], mechanisms=["class A"], types=["DRUG"]) for _ in range(3)]
        + [_trial(MS, drugs=["zeta"], mechanisms=["class B"], types=["DRUG"]) for _ in range(4)]
    )
    # class A 6/10 >= 0.4; overall top drug is zeta (4/10, class B); within class A a1 = a2 = 3,
    # name order picks a1, and 3/10 >= drug_share
    assert name_cluster(members, SHORTS, CFG) == "MS · class A (a1)"


def test_mechanism_drug_share_is_measured_over_all_members() -> None:
    members = (
        [_trial(MS, drugs=[f"a{i}"], mechanisms=["class A"], types=["DRUG"]) for i in range(5)]
        + [_trial(MS, drugs=["zeta"], mechanisms=["class B"], types=["DRUG"]) for _ in range(4)]
        + [_trial(MS, types=["BEHAVIORAL"]) for _ in range(3)]
    )
    # class A 5/9 drug-bearing >= 0.4; each class-A drug is 1/12 < 0.15 of all members: no suffix,
    # and zeta (4/12, another class) is never borrowed
    assert name_cluster(members, SHORTS, CFG) == "MS · class A"


def test_kind_follows_the_branch_that_named_the_middle() -> None:
    mech = [_trial(MS, drugs=["d"], mechanisms=["class A"], types=["DRUG"]) for _ in range(3)]
    assert name_and_kind(mech, SHORTS, CFG) == ("MS · class A (d)", "mechanism")
    typed = [_trial(MS, types=["BEHAVIORAL"]) for _ in range(3)]
    assert name_and_kind(typed, SHORTS, CFG) == ("MS · behavioural", "type")
    mixed = [
        _trial(MS, drugs=[f"d{i}"], mechanisms=[f"m{i}"], types=[t])
        for i, t in enumerate(["DRUG", "DEVICE", "BEHAVIORAL", "PROCEDURE"])
    ]
    assert name_and_kind(mixed, SHORTS, CFG) == (
        "MS · mixed (d0)",
        "mixed",
    )  # each drug 1/4: suffix as today
    assert name_and_kind([], {}, CFG) == ("Mixed", "mixed")
    # a mixed disease part does not change the kind
    other = [_trial(f"Disease {i}", types=["DEVICE"]) for i in range(4)]
    assert name_and_kind(other, {}, CFG) == ("Mixed diseases · devices", "type")


# --- config --------------------------------------------------------------------------


def test_cluster_config_defaults() -> None:
    c = ClusterConfig()
    assert (c.min_cluster_size, c.min_samples) == (25, 10)
    assert (c.disease_share, c.mechanism_share, c.type_share, c.drug_share) == (
        0.6,
        0.4,
        0.5,
        0.15,
    )


@pytest.mark.parametrize(
    "patch",
    [{"min_cluster_size": 1}, {"min_samples": 0}, {"disease_share": 1.5}, {"drug_share": -0.1}],
)
def test_cluster_config_rejects_bad_values(patch: dict[str, Any]) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ClusterConfig(**patch)


def test_repo_config_has_cluster_block_and_shorts(cfg: Any) -> None:
    assert cfg.explorer.clusters == ClusterConfig()
    shorts = {c.label: c.short for c in cfg.conditions if c.short}
    assert shorts == {MS: "MS"}
