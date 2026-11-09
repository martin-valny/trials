"""ChEMBL REST: max phase, mechanisms and indications for a drug."""

from typing import Any

import httpx

from diligence.tools.http import ToolError, get_json
from diligence.types import ToolResult

BASE = "https://www.ebi.ac.uk/chembl/api/data"
MAX_INDICATIONS = 15


def _phase(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _find_molecule(name: str, http: httpx.Client) -> dict[str, Any] | None:
    for params in (
        {"pref_name__iexact": name},
        {"molecule_synonyms__molecule_synonym__iexact": name},
    ):
        mols = get_json(http, f"{BASE}/molecule.json", {**params, "limit": 5}).get("molecules", [])
        if mols:
            # Prefer a molecule that is its own parent (not a salt).
            for m in mols:
                if (m.get("molecule_hierarchy") or {}).get("parent_chembl_id") in (
                    None,
                    m.get("molecule_chembl_id"),
                ):
                    return m  # type: ignore[no-any-return]
            return mols[0]  # type: ignore[no-any-return]
    return None


def chembl_drug(name: str, *, http: httpx.Client) -> ToolResult:
    args = {"name": name}
    try:
        mol = _find_molecule(name, http)
        if mol is None or not mol.get("molecule_chembl_id"):
            return ToolResult(
                name="chembl_drug", args=args, data={"note": "Drug not found in ChEMBL"}
            )
        cid = mol["molecule_chembl_id"]
        mechs = get_json(http, f"{BASE}/mechanism.json", {"molecule_chembl_id": cid, "limit": 20})
        inds = get_json(
            http, f"{BASE}/drug_indication.json", {"molecule_chembl_id": cid, "limit": 100}
        )
        best: dict[str, float] = {}
        for i in inds.get("drug_indications", []):
            term = i.get("mesh_heading") or i.get("efo_term")
            if term:
                best[term] = max(best.get(term, 0.0), _phase(i.get("max_phase_for_ind")))
        indications = [
            {"indication": t, "max_phase": p}
            for t, p in sorted(best.items(), key=lambda kv: (-kv[1], kv[0]))
        ][:MAX_INDICATIONS]
        mechanisms = [
            {"mechanism": m.get("mechanism_of_action"), "action": m.get("action_type")}
            for m in mechs.get("mechanisms", [])
        ]
        data = {
            "chembl_id": cid,
            "name": mol.get("pref_name") or name,
            "max_phase": _phase(mol.get("max_phase")),
            "mechanisms": mechanisms,
            "indications": indications,
        }
        return ToolResult(name="chembl_drug", args=args, data=data, ids=[cid])
    except (ToolError, ValueError, AttributeError) as exc:
        return ToolResult(name="chembl_drug", args=args, error=f"ChEMBL unavailable: {exc}")
