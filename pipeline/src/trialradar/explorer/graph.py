"""The mechanism graph, ``mechanisms.json``: drug → target → pathway (spec 2026-11-06 §7.1,
amended by 2026-11-08 §6.4).

- **Drug nodes** are the drugs the explorer sorted as ``targeted`` (``drug_index``), each with
  the trials that name it.
- A drug with gene targets ``acts_on`` ``target:<GENE>``; a molecular drug without one (cladribine,
  ``DNA inhibitor``) acts on a class node ``class:<mechanism_class>``, which has no pathway.
- A gene target is ``in_pathway`` of its lowest-level pathways (Reactome, or the GO / curated
  fallback), each pathway links to its ``parent`` and Reactome pathways that share genes are
  joined by ``shares_genes`` (context only).
- Counts per node: ``n``, ``running`` and ``stopped`` over every trial that reaches it,
  ``finished`` over pool trials, and ``succeeded`` by 1b: a pool trial whose ``succeeded_by``
  holds a drug that reaches the node.
- ``max_nodes`` caps every node (spec §7.1, ~150–300 in total). Drugs go in by rank: those
  credited with a success (in any trial's ``succeeded_by``) first, by trials then name, then
  whole tiers of trial count, most trials first, while drugs plus the targets they add fit in
  the cap less the pathway reserve (``pathway_share``). A target is kept when a kept drug acts
  on it; pathways are pruned into what is left. ``cut`` records what was left out, so the page
  can say so and still find a dropped drug's trials.
- The cap changes what is drawn, never what a node counts: a kept target or pathway counts the
  trials of every mapped drug that reaches it, drawn or not. The cap keeps every drug credited
  with a success and drops low-trial drugs that have none, so counting only the drawn drugs
  would drop failed pool trials from the denominator and push every share up. A target or
  pathway node lists, as ``extra_trials``, the trials that reach it only through drugs that are
  not drawn (omitted when there are none), so the page can list all of a node's trials.
- Positions come from a seeded Fruchterman–Reingold layout of the structure alone (never the
  outcomes), normalised to [-1, 1].
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Any

import numpy as np

from trialradar.config import AreaConfig, GraphConfig
from trialradar.mechanisms.io import DrugMapping, read_mappings
from trialradar.mechanisms.pathways import Pathways, read_pathways

_RESOLVED = ("mapped", "manual")
_STRUCTURE = ("acts_on", "in_pathway", "parent")
_DECIMALS = 4


def drug_id(name: str) -> str:
    return f"drug:{name}"


def target_id(gene: str) -> str:
    return f"target:{gene}"


def class_id(mechanism_class: str) -> str:
    return f"class:{mechanism_class}"


def _ancestors(pid: str, parents: Mapping[str, tuple[str, ...]]) -> set[str]:
    out: set[str] = set()
    stack = list(parents.get(pid, ()))
    while stack:
        p = stack.pop()
        if p not in out:
            out.add(p)
            stack.extend(parents.get(p, ()))
    return out


def _nearest_kept(pid: str, parents: Mapping[str, tuple[str, ...]], kept: set[str]) -> set[str]:
    """``pid`` if kept, else its nearest kept ancestors on every upward path."""
    if pid in kept:
        return {pid}
    out: set[str] = set()
    for p in parents.get(pid, ()):
        out |= _nearest_kept(p, parents, kept)
    return out


def _lowest(ids: set[str], parents: Mapping[str, tuple[str, ...]]) -> list[str]:
    """``ids`` without any that is an ancestor of another."""
    above = set().union(*(_ancestors(p, parents) for p in ids)) if ids else set()
    return sorted(ids - above)


def _prune(
    universe: set[str],
    parents: Mapping[str, tuple[str, ...]],
    top: set[str],
    reach_targets: Mapping[str, set[str]],
    n_trials: Mapping[str, int],
    single_ok: Mapping[str, bool],
    cap: int,
) -> set[str]:
    """Drop leaf pathways until at most ``cap`` remain.

    First the Reactome pathways (below the top level) reached by a single target, then any
    leaf by fewest trials, top-level pathways last; ties by id. Only leaves go, so a pathway
    on the way from a kept pathway to its ancestors stays, and a kept pathway's parents are
    always kept."""
    kept = set(universe)
    n_children: dict[str, int] = defaultdict(int)
    for pid in kept:
        for p in parents.get(pid, ()):
            n_children[p] += 1
    while len(kept) > cap:
        leaves = [p for p in kept if n_children[p] == 0]
        single = [p for p in leaves if single_ok[p] and len(reach_targets[p]) == 1]
        pool = single or leaves
        drop = min(pool, key=lambda p: (p in top, n_trials[p], p))
        kept.discard(drop)
        for p in parents.get(drop, ()):
            n_children[p] -= 1
    return kept


def _select_drugs(
    acts: Mapping[str, list[str]],
    n_trials: Mapping[str, int],
    credited: set[str],
    budget: int,
) -> tuple[list[str], bool, int | None]:
    """The drugs kept within ``budget`` drug + target nodes, whether every credited drug is
    among them, and the fewest trials of a kept drug not credited with a success.

    Credited drugs first (most trials, then name), each while it fits; then, only when every
    credited drug fits, whole tiers of the others by trial count, most first, stopping at the
    first tier that does not fit."""
    kept: list[str] = []
    have: set[str] = set()
    used = 0
    for d in sorted((d for d in acts if d in credited), key=lambda d: (-n_trials[d], d)):
        cost = 1 + len(set(acts[d]) - have)
        if used + cost > budget:
            return kept, False, None
        kept.append(d)
        have |= set(acts[d])
        used += cost
    tiers: dict[int, list[str]] = defaultdict(list)
    for d in acts:
        if d not in credited:
            tiers[n_trials[d]].append(d)
    floor: int | None = None
    for n in sorted(tiers, reverse=True):
        tier = sorted(tiers[n])
        new = set().union(*(acts[d] for d in tier)) - have
        cost = len(tier) + len(new)
        if used + cost > budget:
            break
        kept += tier
        have |= new
        used += cost
        floor = n
    return kept, True, floor


def _layout(
    ids: list[str], edges: list[tuple[str, str, float]], iterations: int, seed: int
) -> np.ndarray:
    """Seeded Fruchterman–Reingold in 2D (own numpy implementation), normalised to [-1, 1].

    Repulsion k²/d between every pair, attraction d²/k · weight along edges, a weak pull to the
    centre so separate components stay in frame, and a linearly cooling step cap."""
    n = len(ids)
    if n <= 1:
        return np.zeros((n, 2))
    rng = np.random.default_rng(seed)
    pos = rng.uniform(-1.0, 1.0, size=(n, 2))
    index = {node: i for i, node in enumerate(ids)}
    src = np.array([index[s] for s, _t, _w in edges], dtype=np.int64)
    dst = np.array([index[t] for _s, t, _w in edges], dtype=np.int64)
    weight = np.array([w for _s, _t, w in edges], dtype=np.float64)
    k = float(np.sqrt(4.0 / n))
    gravity = 0.05 * k
    start = 0.1
    for step in range(iterations):
        x, y = pos[:, 0], pos[:, 1]
        dx = x[:, None] - x[None, :]
        dy = y[:, None] - y[None, :]
        dist2 = np.maximum(dx * dx + dy * dy, 1e-6)
        rep = (k * k) / dist2
        np.fill_diagonal(rep, 0.0)
        disp = np.stack(((dx * rep).sum(axis=1), (dy * rep).sum(axis=1)), axis=1)
        if len(edges):
            d = pos[src] - pos[dst]
            dist = np.maximum(np.sqrt((d * d).sum(axis=1)), 1e-6)
            pull = (weight * dist / k)[:, None] * d
            np.add.at(disp, src, -pull)
            np.add.at(disp, dst, pull)
        disp -= gravity * pos * n
        length = np.maximum(np.sqrt((disp * disp).sum(axis=1)), 1e-12)
        temp = start * (1.0 - step / iterations)
        pos = pos + disp * (np.minimum(length, temp) / length)[:, None]
    centre = (pos.max(axis=0) + pos.min(axis=0)) / 2.0
    pos = pos - centre
    scale = float(np.abs(pos).max())
    return pos / scale if scale > 0 else pos


def _counts(
    trials: set[str], drugs: set[str], rows: Mapping[str, Mapping[str, Any]]
) -> dict[str, Any]:
    """The counts of a node reached by ``trials``, whose drugs (1b credit) are ``drugs``."""
    pool = [rows[t] for t in trials if rows[t].get("in_pool")]
    return {
        "n": len(trials),
        "running": sum(rows[t].get("outcome") == "running" for t in trials),
        "stopped": sum(rows[t].get("outcome") == "stopped" for t in trials),
        "finished": len(pool),
        "succeeded": sum(bool(set(r.get("succeeded_by") or ()) & drugs) for r in pool),
        "conditions": sorted({c for t in trials for c in rows[t].get("condition_labels") or ()}),
    }


def build_graph(
    explorer_doc: Mapping[str, Any],
    mappings: Mapping[str, DrugMapping],
    pathways: Pathways,
    cfg: GraphConfig,
    seed: int,
    *,
    names: Mapping[str, Iterable[str]] | None = None,
) -> dict[str, Any]:
    """The ``mechanisms.json`` document.

    ``names`` adds, per trial, the names looked up in the drug mapping beyond its ``drugs``
    (supplement, genetic and combination-product interventions), so those drugs' nodes list
    their trials too."""
    rows = {t["nct_id"]: t for t in explorer_doc.get("trials", [])}
    index: Mapping[str, Mapping[str, Any]] = explorer_doc.get("drug_index") or {}
    kind_keys = set(explorer_doc.get("kinds") or {})
    targeted = {d for d, v in index.items() if "targeted" in (v.get("approaches") or ())}

    drug_trials: dict[str, set[str]] = defaultdict(set)
    for nct, row in rows.items():
        for d in {*row.get("drugs", ()), *((names or {}).get(nct, ()))}:
            if d in targeted:
                drug_trials[d].add(nct)

    # drug -> targets (gene or class nodes)
    acts: dict[str, list[str]] = {}
    actions: dict[str, str] = {}
    genes: set[str] = set()
    for d in sorted(drug_trials):
        m = mappings.get(d)
        if m is None or m.status not in _RESOLVED:
            continue
        if m.targets:
            acts[d] = [target_id(g) for g in sorted(set(m.targets))]
            genes |= set(m.targets)
        else:
            classes = sorted({c for c in m.mechanism_class if c not in kind_keys})
            if not classes:
                continue
            acts[d] = [class_id(c) for c in classes]
        unique = list(dict.fromkeys(a for a in m.action_type if a))
        if unique:
            actions[d] = "; ".join(unique)

    refs = pathways.pathways
    parents = {pid: tuple(p for p in ref.parents if p in refs) for pid, ref in refs.items()}

    def reach(gene_set: Iterable[str]) -> tuple[set[str], dict[str, set[str]]]:
        """Pathways reached by the genes (lowest-level ones plus ancestors), and the genes
        reaching each."""
        universe: set[str] = set()
        by: dict[str, set[str]] = defaultdict(set)
        for g in sorted(gene_set):
            for pid in (p for p in pathways.targets.get(g, ()) if p in refs):
                for p in {pid} | _ancestors(pid, parents):
                    universe.add(p)
                    by[p].add(g)
        return universe, by

    # the cap: drugs by rank, the targets they act on, pathways in what is left
    all_targets = {tid for tids in acts.values() for tid in tids}
    all_universe, _ = reach(genes)
    credited = {d for row in rows.values() for d in row.get("succeeded_by") or ()}
    n_of = {d: len(drug_trials[d]) for d in acts}
    reserve = min(int(cfg.max_nodes * cfg.pathway_share), len(all_universe))
    chosen, all_credited, floor = _select_drugs(
        acts, n_of, credited & set(acts), cfg.max_nodes - reserve
    )
    dropped = sorted(set(acts) - set(chosen), key=lambda d: (-n_of[d], d))
    # every mapped drug, drawn or not: the counts run over these (never biased by the cap)
    all_acts, all_genes = acts, genes
    acts = {d: acts[d] for d in sorted(chosen)}
    genes = {
        tid.split(":", 1)[1] for tids in acts.values() for tid in tids if tid.startswith("target:")
    }
    n_targets = len({tid for tids in acts.values() for tid in tids})
    lowest = {g: {p for p in pathways.targets.get(g, ()) if p in refs} for g in sorted(genes)}
    universe, reach_targets = reach(genes)

    target_trials: dict[str, set[str]] = defaultdict(set)
    target_drugs: dict[str, set[str]] = defaultdict(set)
    for d, tids in all_acts.items():
        for tid in tids:
            target_trials[tid] |= drug_trials[d]
            target_drugs[tid].add(d)
    # pruning ranks pathways by the trials of the drawn drugs, so the drawn structure is the
    # drawn drugs' own; only the counts below run over every mapped drug
    drawn_trials: dict[str, set[str]] = defaultdict(set)
    for d, tids in acts.items():
        for tid in tids:
            drawn_trials[tid] |= drug_trials[d]
    top = {p for p in universe if refs[p].source == "reactome" and not parents.get(p)}
    pre_n = {
        p: len(set().union(*(drawn_trials[target_id(g)] for g in reach_targets[p])))
        for p in universe
    }
    single_ok = {p: refs[p].source == "reactome" and p not in top for p in universe}
    room = max(0, cfg.max_nodes - len(acts) - n_targets)
    kept = _prune(universe, parents, top, reach_targets, pre_n, single_ok, room)

    edges: list[dict[str, Any]] = []
    for d, tids in acts.items():
        for tid in tids:
            e: dict[str, Any] = {"source": drug_id(d), "target": tid, "kind": "acts_on"}
            if d in actions:
                e["action"] = actions[d]
            edges.append(e)
    in_pathway: dict[str, list[str]] = {}
    for g, ids in lowest.items():
        nearest: set[str] = set()
        for pid in ids:
            nearest |= _nearest_kept(pid, parents, kept)
        in_pathway[g] = _lowest(nearest, parents)
        for pid in in_pathway[g]:
            edges.append(
                {
                    "source": target_id(g),
                    "target": pid,
                    "kind": "in_pathway",
                    "source_db": refs[pid].source,
                }
            )
    for pid in sorted(kept):
        for p in parents.get(pid, ()):
            edges.append({"source": pid, "target": p, "kind": "parent"})
    edges += _shares_genes(pathways, kept, cfg)

    # node counts: each kept pathway over every mapped gene reaching it (its own lowest
    # pathways or a descendant of it, pruned or not)
    path_trials: dict[str, set[str]] = defaultdict(set)
    path_drugs: dict[str, set[str]] = defaultdict(set)
    for g in sorted(all_genes):
        tid = target_id(g)
        for pid in (p for p in pathways.targets.get(g, ()) if p in refs):
            for p in ({pid} | _ancestors(pid, parents)) & kept:
                path_trials[p] |= target_trials[tid]
                path_drugs[p] |= target_drugs[tid]

    def extra(trials: set[str], drugs: set[str]) -> dict[str, Any]:
        """The trials reaching a node only through drugs that are not drawn."""
        drawn = set().union(*(drug_trials[d] for d in drugs if d in acts))
        rest = sorted(trials - drawn)
        return {"extra_trials": rest} if rest else {}

    nodes: dict[str, dict[str, Any]] = {}
    for d in acts:
        node: dict[str, Any] = {"id": drug_id(d), "kind": "drug", "label": d}
        m = mappings[d]
        if m.chembl_id:
            node["chembl_id"] = m.chembl_id
        node["trials"] = sorted(drug_trials[d])
        node.update(_counts(drug_trials[d], {d}, rows))
        nodes[node["id"]] = node
    for tid in sorted({tid for tids in acts.values() for tid in tids}):
        label = tid.split(":", 1)[1]
        node = {"id": tid, "kind": "target", "label": label}
        node.update(_counts(target_trials[tid], target_drugs[tid], rows))
        node.update(extra(target_trials[tid], target_drugs[tid]))
        nodes[tid] = node
    for pid in sorted(kept):
        ref = refs[pid]
        node = {
            "id": pid,
            "kind": "pathway",
            "label": ref.name,
            "source": ref.source,
            "top_level": pid in top,
        }
        if ref.source == "curated" and pathways.urls.get(pid):
            node["source_url"] = pathways.urls[pid]
        node.update(_counts(path_trials[pid], path_drugs[pid], rows))
        node.update(extra(path_trials[pid], path_drugs[pid]))
        nodes[pid] = node

    order = sorted(nodes)
    structure = [
        (e["source"], e["target"], 1.0 if e["kind"] in _STRUCTURE else float(e["weight"]))
        for e in edges
    ]
    pos = _layout(order, structure, cfg.layout_iterations, seed)
    for i, nid in enumerate(order):
        nodes[nid]["x"] = round(float(pos[i, 0]), _DECIMALS)
        nodes[nid]["y"] = round(float(pos[i, 1]), _DECIMALS)

    return {
        "generated_for": explorer_doc.get("generated_for"),
        "reactome_release": pathways.release,
        "method": {
            "max_nodes": cfg.max_nodes,
            "pathway_share": cfg.pathway_share,
            "overlap_floor": cfg.overlap_floor,
            "overlap_top_k": cfg.overlap_top_k,
            "seed": seed,
        },
        "cut": {
            "drugs": {"before": len(n_of), "after": len(acts)},
            "targets": {"before": len(all_targets), "after": n_targets},
            "pathways": {"before": len(all_universe), "after": len(kept)},
            "min_trials": floor,
            "all_succeeded": all_credited,
            "dropped": [
                {"drug": d, "n": n_of[d], "trials": sorted(drug_trials[d])} for d in dropped
            ],
        },
        "nodes": [nodes[i] for i in order],
        "edges": sorted(edges, key=lambda e: (e["kind"], e["source"], e["target"])),
    }


def _shares_genes(pathways: Pathways, kept: set[str], cfg: GraphConfig) -> list[dict[str, Any]]:
    """Reactome overlaps between kept pathways at or above the floor, each kept only when it is
    among the ``overlap_top_k`` strongest of both its pathways (so no node has more)."""
    cands = [
        (a, b, j)
        for a, b, j in pathways.overlaps
        if a in kept and b in kept and j >= cfg.overlap_floor
    ]
    by_node: dict[str, list[tuple[float, str, str, str]]] = defaultdict(list)
    for a, b, j in cands:
        by_node[a].append((-j, b, a, b))
        by_node[b].append((-j, a, a, b))
    best: dict[str, set[tuple[str, str]]] = {
        node: {(a, b) for _j, _o, a, b in sorted(rows)[: cfg.overlap_top_k]}
        for node, rows in by_node.items()
    }
    return [
        {"source": a, "target": b, "kind": "shares_genes", "weight": j, "source_db": "reactome"}
        for a, b, j in sorted(cands)
        if (a, b) in best[a] and (a, b) in best[b]
    ]


def load_graph(
    explorer_doc: Mapping[str, Any],
    cfg: AreaConfig,
    names: Mapping[str, Iterable[str]] | None = None,
) -> dict[str, Any]:
    """The graph from the files in ``cfg.mechanisms_dir``. Raises ``OSError`` or ``ValueError``
    when the mapping or the pathway files are missing or invalid, or when there is no approach
    config (then no drug is sorted as targeted)."""
    if not explorer_doc.get("approaches"):
        raise ValueError("no approach config, so no drug is sorted as targeted")
    mappings = read_mappings(cfg.mechanisms_dir)
    pathways = read_pathways(cfg.mechanisms_dir)
    return build_graph(
        explorer_doc, mappings, pathways, cfg.explorer.graph, cfg.explorer.seed, names=names
    )
