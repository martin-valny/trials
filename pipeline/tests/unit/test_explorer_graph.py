"""The mechanism graph, ``mechanisms.json`` (spec 2026-11-06 §7.1, amended 2026-11-08)."""

from __future__ import annotations

import copy
import json
import shutil
from collections import defaultdict
from collections.abc import Iterable
from datetime import date
from pathlib import Path
from typing import Any

from integration.conftest import Env, FakeClient, day1_studies

from trialradar.config import AreaConfig, GraphConfig
from trialradar.explorer.graph import build_graph
from trialradar.mechanisms.io import DrugMapping, read_mappings
from trialradar.mechanisms.pathways import PathwayRef, Pathways, read_pathways

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "mechanisms"
CFG = GraphConfig(max_nodes=250, overlap_floor=0.3, overlap_top_k=3, layout_iterations=60)
SEED = 42
D1, TS1 = date(2026, 3, 1), "2026-03-01T06:00:00"

TOP_KEYS = {"generated_for", "reactome_release", "method", "cut", "nodes", "edges"}
NODE_KEYS = {
    "id",
    "kind",
    "label",
    "x",
    "y",
    "n",
    "finished",
    "succeeded",
    "stopped",
    "running",
    "conditions",
}


# --- helpers ---------------------------------------------------------------------------------


def _drug(
    name: str,
    classes: Iterable[str],
    targets: Iterable[str] = (),
    action: Iterable[str] = (),
    status: str = "mapped",
    chembl: str | None = None,
) -> DrugMapping:
    return DrugMapping(
        drug=name,
        status=status,  # type: ignore[arg-type]
        chembl_id=chembl,
        modality="small molecule",
        mechanism_class=tuple(classes),
        mechanism=(),
        action_type=tuple(action),
        targets=tuple(targets),
    )


MAPPINGS = {
    m.drug: m
    for m in (
        _drug("ocrelizumab", ["anti-CD20"], ["MS4A1"], ["INHIBITOR"], chembl="CHEMBL2108041"),
        _drug("inebilizumab", ["anti-CD19"], ["CD19"], ["INHIBITOR"]),
        _drug("fingolimod", ["S1P receptor modulator"], ["S1PR1"], ["MODULATOR"]),
        _drug("efgartigimod", ["FcRn antagonist"], ["FCGRT"], ["ANTAGONIST"]),
        _drug("cladribine", ["DNA inhibitor"]),
        _drug("mesenchymal stem cells", ["msc"], status="manual"),
    )
}

TARGETED = {"approaches": ["targeted"], "kinds": [], "mechanisms": [], "modalities": []}
INDEX: dict[str, dict[str, list[str]]] = {
    "ocrelizumab": TARGETED,
    "inebilizumab": TARGETED,
    "fingolimod": TARGETED,
    "efgartigimod": TARGETED,
    "cladribine": TARGETED,
    "mesenchymal stem cells": {
        "approaches": ["cell"],
        "kinds": ["msc"],
        "mechanisms": [],
        "modalities": [],
    },
}


def _ref(
    pid: str, name: str, parents: tuple[str, ...] = (), source: str = "reactome"
) -> PathwayRef:
    return PathwayRef(pid, name, parents, 0 if source != "reactome" else 10, source)  # type: ignore[arg-type]


PATHWAYS = Pathways(
    release="98",
    targets={
        "MS4A1": ("R-HSA-A",),
        "CD19": ("R-HSA-B",),
        "S1PR1": ("R-HSA-C",),
        "FCGRT": ("GO:0002416",),
    },
    pathways={
        p.id: p
        for p in (
            _ref("R-HSA-TOP1", "Immune System"),
            _ref("R-HSA-MID", "Signaling by the BCR", ("R-HSA-TOP1",)),
            _ref("R-HSA-A", "Antigen activates BCR", ("R-HSA-MID",)),
            _ref("R-HSA-B", "CD19 signalling", ("R-HSA-MID",)),
            _ref("R-HSA-TOP2", "Signal Transduction"),
            _ref("R-HSA-C", "Lysosphingolipid receptors", ("R-HSA-TOP2",)),
            _ref("GO:0002416", "IgG transcytosis mediated by FcRn", source="go"),
        )
    },
    overlaps=(("R-HSA-A", "R-HSA-C", 0.4), ("R-HSA-A", "R-HSA-B", 0.1)),
)


def _trial(
    nct: str,
    drugs: Iterable[str],
    *,
    outcome: str = "running",
    in_pool: bool = False,
    succeeded_by: Iterable[str] = (),
    conditions: Iterable[str] = ("Multiple sclerosis",),
) -> dict[str, Any]:
    return {
        "nct_id": nct,
        "drugs": sorted(drugs),
        "outcome": outcome,
        "in_pool": in_pool,
        "succeeded_by": sorted(succeeded_by),
        "condition_labels": list(conditions),
    }


def _doc(trials: list[dict[str, Any]], index: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "generated_for": "2026-03-01",
        "trials": trials,
        "drug_index": INDEX if index is None else index,
        "kinds": {"msc": {"approach": "cell"}},
    }


TRIALS = [
    _trial(
        "NCT01", ["ocrelizumab"], outcome="succeeded", in_pool=True, succeeded_by=["ocrelizumab"]
    ),
    _trial(
        "NCT02",
        ["ocrelizumab", "fingolimod"],
        outcome="succeeded",
        in_pool=True,
        succeeded_by=["fingolimod"],
        conditions=["Myasthenia gravis"],
    ),
    _trial("NCT03", ["inebilizumab"], outcome="stopped", in_pool=True),
    _trial("NCT04", ["efgartigimod"]),
    _trial("NCT05", ["cladribine"], outcome="completed_unknown", in_pool=True),
]


def _nodes(g: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {n["id"]: n for n in g["nodes"]}


def _edges(g: dict[str, Any], kind: str) -> set[tuple[str, str]]:
    return {(e["source"], e["target"]) for e in g["edges"] if e["kind"] == kind}


def _build(trials: list[dict[str, Any]] = TRIALS, **kw: Any) -> dict[str, Any]:
    cfg = kw.pop("cfg", CFG)
    return build_graph(_doc(trials), MAPPINGS, PATHWAYS, cfg, SEED, **kw)


# --- tests -----------------------------------------------------------------------------------


def test_nodes_and_edges_from_fixture() -> None:
    """The committed fixture mapping and pathways give the expected small graph."""
    mappings = read_mappings(FIXTURES)
    pathways = read_pathways(FIXTURES)
    index = {"example drug": TARGETED, "dimethyl fumarate": TARGETED}
    trials = [
        _trial(
            "NCT90000001",
            ["example drug"],
            outcome="succeeded",
            in_pool=True,
            succeeded_by=["example drug"],
        ),
        _trial("NCT90000002", ["dimethyl fumarate"]),
    ]
    g = build_graph(_doc(trials, index), mappings, pathways, CFG, SEED)

    assert set(g) == TOP_KEYS
    assert g["generated_for"] == "2026-03-01"
    assert g["reactome_release"] == "test"
    assert g["method"] == {
        "max_nodes": 250,
        "pathway_share": 0.3,
        "overlap_floor": 0.3,
        "overlap_top_k": 3,
        "seed": 42,
    }
    nodes = _nodes(g)
    assert set(nodes) == {
        "drug:example drug",
        "drug:dimethyl fumarate",
        "target:MS4A1",
        "target:NFE2L2",
        *pathways.pathways,
    }
    for n in nodes.values():
        assert NODE_KEYS <= set(n)
        assert -1.0 <= n["x"] <= 1.0 and -1.0 <= n["y"] <= 1.0
    assert nodes["drug:example drug"]["kind"] == "drug"
    assert nodes["drug:example drug"]["trials"] == ["NCT90000001"]
    assert "trials" not in nodes["target:MS4A1"]
    assert nodes["target:MS4A1"]["kind"] == "target"
    assert nodes["target:MS4A1"]["label"] == "MS4A1"
    assert nodes["R-HSA-168256"] | {"x": 0, "y": 0} == {
        "id": "R-HSA-168256",
        "kind": "pathway",
        "label": "Immune System",
        "source": "reactome",
        "top_level": True,
        "x": 0,
        "y": 0,
        "n": 1,
        "finished": 1,
        "succeeded": 1,
        "stopped": 0,
        "running": 0,
        "conditions": ["Multiple sclerosis"],
    }

    assert _edges(g, "acts_on") == {
        ("drug:example drug", "target:MS4A1"),
        ("drug:dimethyl fumarate", "target:NFE2L2"),
    }
    acts = {e["source"]: e for e in g["edges"] if e["kind"] == "acts_on"}
    assert acts["drug:example drug"]["action"] == "ANTAGONIST"
    assert _edges(g, "in_pathway") == {
        ("target:MS4A1", "R-HSA-983695"),
        ("target:NFE2L2", "R-HSA-9759194"),
    }
    assert all(e["source_db"] == "reactome" for e in g["edges"] if e["kind"] == "in_pathway")
    assert ("R-HSA-983695", "R-HSA-983705") in _edges(g, "parent")
    assert ("R-HSA-2262752", "R-HSA-8953897") in _edges(g, "parent")
    assert len(_edges(g, "parent")) == 7
    (shared,) = [e for e in g["edges"] if e["kind"] == "shares_genes"]
    assert (shared["source"], shared["target"], shared["weight"]) == (
        "R-HSA-983695",
        "R-HSA-9759194",
        0.5,
    )


def test_class_target_node_without_pathway() -> None:
    """Review focus 2: cladribine (a molecular class, no gene) acts on a class target node
    that has no pathway."""
    g = _build()
    nodes = _nodes(g)
    node = nodes["class:DNA inhibitor"]
    assert node["kind"] == "target" and node["label"] == "DNA inhibitor"
    assert node["n"] == 1 and node["finished"] == 1
    assert _edges(g, "acts_on") >= {("drug:cladribine", "class:DNA inhibitor")}
    assert not any(e["source"] == "class:DNA inhibitor" for e in g["edges"])


def test_go_target_marked() -> None:
    g = _build()
    nodes = _nodes(g)
    assert nodes["GO:0002416"]["source"] == "go"
    assert nodes["GO:0002416"]["top_level"] is False
    (edge,) = [e for e in g["edges"] if e["source"] == "target:FCGRT"]
    assert edge["kind"] == "in_pathway" and edge["source_db"] == "go"


def test_curated_node_carries_source_url() -> None:
    """A curated pathway node links to its source; Reactome and GO nodes carry no url."""
    pathways = Pathways(
        release=PATHWAYS.release,
        targets={**PATHWAYS.targets, "S1PR1": ("curated:egress",)},
        pathways={
            **PATHWAYS.pathways,
            "curated:egress": _ref("curated:egress", "lymphocyte egress", source="curated"),
        },
        overlaps=PATHWAYS.overlaps,
        urls={"curated:egress": "https://example.org/fingolimod"},
    )
    g = build_graph(_doc(TRIALS), MAPPINGS, pathways, CFG, SEED)
    nodes = _nodes(g)
    assert nodes["curated:egress"]["source"] == "curated"
    assert nodes["curated:egress"]["source_url"] == "https://example.org/fingolimod"
    assert "source_url" not in nodes["GO:0002416"]
    assert "source_url" not in nodes["R-HSA-A"]


def test_no_target_kinds_never_in_graph() -> None:
    """An ``msc`` trial (a kind, not a molecular drug) adds no node."""
    base = _build()
    with_msc = _build([*TRIALS, _trial("NCT06", ["mesenchymal stem cells"])])
    assert [n["id"] for n in with_msc["nodes"]] == [n["id"] for n in base["nodes"]]
    assert not any("mesenchymal" in n["id"] or n["id"].endswith(":msc") for n in with_msc["nodes"])


def test_counts_use_1b() -> None:
    """A pool trial counts as succeeded at a node only through a drug in its ``succeeded_by``
    that reaches the node."""
    nodes = _nodes(_build())
    # NCT02 (ocrelizumab + fingolimod) succeeded because fingolimod moved on.
    s1pr1 = nodes["target:S1PR1"]
    assert (s1pr1["n"], s1pr1["finished"], s1pr1["succeeded"]) == (1, 1, 1)
    ms4a1 = nodes["target:MS4A1"]
    assert (ms4a1["n"], ms4a1["finished"], ms4a1["succeeded"]) == (2, 2, 1)  # only NCT01
    assert ms4a1["conditions"] == ["Multiple sclerosis", "Myasthenia gravis"]
    ocr = nodes["drug:ocrelizumab"]
    assert ocr["trials"] == ["NCT01", "NCT02"] and ocr["succeeded"] == 1
    top1 = nodes["R-HSA-TOP1"]  # ocrelizumab (2 trials) and inebilizumab (1, stopped)
    assert (top1["n"], top1["finished"], top1["succeeded"], top1["stopped"]) == (3, 3, 1, 1)
    top2 = nodes["R-HSA-TOP2"]  # fingolimod only
    assert (top2["n"], top2["succeeded"]) == (1, 1)
    efg = nodes["drug:efgartigimod"]
    assert (efg["n"], efg["running"], efg["finished"]) == (1, 1, 0)


def test_succeeded_needs_pool() -> None:
    trials = [_trial("NCT01", ["fingolimod"], outcome="succeeded", succeeded_by=["fingolimod"])]
    assert _nodes(_build(trials))["target:S1PR1"]["succeeded"] == 0


def test_supplement_names_reach_drug_nodes() -> None:
    """Names looked up in the mapping beyond ``drugs`` (a supplement) are passed in."""
    trials = [_trial("NCT01", [])]
    g = _build(trials, names={"NCT01": ["fingolimod"]})
    assert _nodes(g)["drug:fingolimod"]["trials"] == ["NCT01"]


def _kinds(g: dict[str, Any]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for n in g["nodes"]:
        out[n["kind"]].add(n["id"])
    return out


def test_pathway_pruning_into_remaining_budget() -> None:
    """Pathways are pruned by the existing rule into what the drugs and targets leave: single-
    target leaves first, then the leaves reached by the fewest trials; a target keeps an edge
    to its nearest kept ancestor."""
    full = _build()
    assert len(_kinds(full)["pathway"]) == 7
    assert len(full["nodes"]) == 5 + 5 + 7

    # 10 drugs and targets; 4 left for pathways.
    g = _build(cfg=CFG.model_copy(update={"max_nodes": 14}))
    nodes = _nodes(g)
    kinds = _kinds(g)
    assert len(g["nodes"]) <= 14
    assert len(kinds["pathway"]) == 4
    assert kinds["drug"] | kinds["target"] == _kinds(full)["drug"] | _kinds(full)["target"]
    # the GO node is the only pathway of FCGRT: single-target leaves of Reactome go first
    assert "GO:0002416" in kinds["pathway"]
    for e in g["edges"]:
        assert e["source"] in nodes and e["target"] in nodes
    in_pw = _edges(g, "in_pathway")
    for gene in ("MS4A1", "CD19"):
        assert any(s == f"target:{gene}" for s, _ in in_pw)
    assert "R-HSA-TOP1" in kinds["pathway"]
    assert g["cut"]["pathways"] == {"before": 7, "after": 4}


def test_max_nodes_caps_all_nodes() -> None:
    """``max_nodes`` caps drugs, targets and pathways together. Drugs credited with a success
    come first (most trials first), then whole tiers of trial count while they fit."""
    trials = [*TRIALS, _trial("NCT07", ["inebilizumab"])]  # inebilizumab: 2 trials
    cfg = CFG.model_copy(update={"max_nodes": 8, "pathway_share": 0.0})
    g = _build(trials, cfg=cfg)
    kinds = _kinds(g)
    assert len(g["nodes"]) <= 8
    # ocrelizumab and fingolimod are credited; inebilizumab is the 2-trial tier; the 1-trial
    # tier (efgartigimod and cladribine, 4 nodes) does not fit.
    assert kinds["drug"] == {"drug:ocrelizumab", "drug:fingolimod", "drug:inebilizumab"}
    assert kinds["target"] == {"target:MS4A1", "target:S1PR1", "target:CD19"}
    assert len(kinds["pathway"]) == 2
    for e in g["edges"]:
        assert e["source"] in _nodes(g) and e["target"] in _nodes(g)
    assert g["cut"] == {
        "drugs": {"before": 5, "after": 3},
        "targets": {"before": 5, "after": 3},
        "pathways": {"before": 7, "after": 2},
        "min_trials": 2,
        "all_succeeded": True,
        "dropped": [
            {"drug": "cladribine", "n": 1, "trials": ["NCT05"]},
            {"drug": "efgartigimod", "n": 1, "trials": ["NCT04"]},
        ],
    }


def test_cut_keeps_whole_tiers() -> None:
    """A tier of drugs with the same trial count goes in whole or not at all, so the caption's
    "those in N or more trials" is true."""
    cfg = CFG.model_copy(update={"max_nodes": 7, "pathway_share": 0.0})
    g = _build(cfg=cfg)
    # successes: 4 nodes; the 1-trial tier (inebilizumab, efgartigimod, cladribine) needs 6
    assert _kinds(g)["drug"] == {"drug:ocrelizumab", "drug:fingolimod"}
    assert g["cut"]["min_trials"] is None
    assert g["cut"]["all_succeeded"] is True
    assert [d["drug"] for d in g["cut"]["dropped"]] == [
        "cladribine",
        "efgartigimod",
        "inebilizumab",
    ]


def test_successes_alone_overflow() -> None:
    """When even the credited drugs do not fit, they go in by trials (then name) while the
    budget allows."""
    cfg = CFG.model_copy(update={"max_nodes": 3, "pathway_share": 0.0})
    g = _build(cfg=cfg)
    assert _kinds(g)["drug"] == {"drug:ocrelizumab"}  # 2 trials; fingolimod would need 2 more
    assert len(g["nodes"]) <= 3
    assert g["cut"]["all_succeeded"] is False
    assert g["cut"]["min_trials"] is None
    assert {"drug": "fingolimod", "n": 1, "trials": ["NCT02"]} in g["cut"]["dropped"]


def test_pathway_share_reserves_room() -> None:
    """``pathway_share`` of the cap is kept for pathways: drugs and targets fill the rest."""
    trials = [*TRIALS, _trial("NCT07", ["inebilizumab"])]
    cfg = CFG.model_copy(update={"max_nodes": 10, "pathway_share": 0.5})
    g = _build(trials, cfg=cfg)
    kinds = _kinds(g)
    # 5 for drugs and targets: the two credited drugs (4) fit, inebilizumab (2 more) does not
    assert kinds["drug"] == {"drug:ocrelizumab", "drug:fingolimod"}
    assert len(kinds["pathway"]) <= 6 and len(g["nodes"]) <= 10
    assert g["method"]["pathway_share"] == 0.5


def test_counts_over_kept_drugs() -> None:
    """A kept target counts only the trials of kept drugs (the drawn structure)."""
    trials = [*TRIALS, _trial("NCT08", ["efgartigimod", "ocrelizumab"])]
    cfg = CFG.model_copy(update={"max_nodes": 4, "pathway_share": 0.0})
    g = _build(trials, cfg=cfg)
    nodes = _nodes(g)
    assert set(_kinds(g)["drug"]) == {"drug:ocrelizumab", "drug:fingolimod"}
    assert nodes["drug:ocrelizumab"]["n"] == 3
    assert "drug:efgartigimod" not in nodes and "target:FCGRT" not in nodes


def test_no_cut_when_everything_fits() -> None:
    g = _build()
    assert g["cut"]["dropped"] == []
    assert g["cut"]["drugs"] == {"before": 5, "after": 5}
    assert g["cut"]["min_trials"] == 1
    tiny = _build(cfg=CFG.model_copy(update={"max_nodes": 0}))
    assert tiny["nodes"] == [] and tiny["edges"] == []
    assert tiny["cut"]["drugs"] == {"before": 5, "after": 0}


def test_overlap_top_k_and_floor() -> None:
    g = _build()
    shared = [
        (e["source"], e["target"], e["weight"]) for e in g["edges"] if e["kind"] == "shares_genes"
    ]
    assert shared == [("R-HSA-A", "R-HSA-C", 0.4)]  # 0.1 is below the floor
    none = _build(cfg=CFG.model_copy(update={"overlap_top_k": 0}))
    assert not _edges(none, "shares_genes")


def test_layout_deterministic() -> None:
    a, b = _build(), _build()
    assert a == b
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    xs = [n["x"] for n in a["nodes"]] + [n["y"] for n in a["nodes"]]
    assert min(xs) >= -1.0 and max(xs) <= 1.0 and max(abs(v) for v in xs) == 1.0


def test_layout_ignores_outcomes() -> None:
    """No leakage: outcomes and success never move a node."""
    flipped = copy.deepcopy(TRIALS)
    for t in flipped:
        t["outcome"], t["in_pool"], t["succeeded_by"] = "running", False, []
    a, b = _build(), _build(flipped)
    assert [(n["id"], n["x"], n["y"]) for n in a["nodes"]] == [
        (n["id"], n["x"], n["y"]) for n in b["nodes"]
    ]


def test_top_level_marked() -> None:
    nodes = _nodes(_build())
    assert nodes["R-HSA-TOP1"]["top_level"] is True
    assert nodes["R-HSA-TOP2"]["top_level"] is True
    assert nodes["R-HSA-MID"]["top_level"] is False
    assert nodes["R-HSA-A"]["top_level"] is False
    assert "top_level" not in nodes["target:MS4A1"]


def test_drug_node_carries_chembl_id() -> None:
    nodes = _nodes(_build())
    assert nodes["drug:ocrelizumab"]["chembl_id"] == "CHEMBL2108041"
    assert "chembl_id" not in nodes["drug:cladribine"]


def test_empty_graph_without_targeted_drugs() -> None:
    g = build_graph(_doc(TRIALS, {}), MAPPINGS, PATHWAYS, CFG, SEED)
    assert g["nodes"] == [] and g["edges"] == []
    assert g["cut"]["drugs"] == {"before": 0, "after": 0} and g["cut"]["min_trials"] is None


def test_missing_pathways_degrades(cfg: AreaConfig, tmp_path: Path) -> None:
    """R19: no ``pathways.json`` → one ``mechanism_graph:`` warning, no ``mechanisms.json``,
    and the run (with its map) succeeds."""
    (tmp_path / "env").mkdir()
    env = Env(tmp_path / "env", cfg)
    mech = tmp_path / "mech"
    shutil.copytree(FIXTURES, mech)
    (mech / "pathways.json").unlink()
    env.cfg = env.cfg.model_copy(update={"mechanisms_dir": mech})
    result = env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    assert result.status == "success"
    assert [w for w in result.warnings if w.startswith("mechanism_graph:")] == [
        next(w for w in result.warnings if w.startswith("mechanism_graph:"))
    ]
    assert (env.site_dir / "explorer.json").exists()
    assert not (env.site_dir / "mechanisms.json").exists()
    meta = json.loads((env.site_dir / "meta.json").read_text())
    assert any(w.startswith("mechanism_graph:") for w in meta["warnings"])


def test_run_writes_mechanisms_json(cfg: AreaConfig, tmp_path: Path) -> None:
    env = Env(tmp_path, cfg)
    result = env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    assert result.status == "success" and result.warnings == []
    g = json.loads((env.site_dir / "mechanisms.json").read_text())
    ids = {n["id"] for n in g["nodes"]}
    assert "target:MS4A1" in ids and "R-HSA-168256" in ids
