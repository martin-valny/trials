import importlib.util
import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

_SPEC = importlib.util.spec_from_file_location(
    "cluster_report", Path(__file__).resolve().parents[2] / "scripts" / "cluster_report.py"
)
assert _SPEC and _SPEC.loader
cr = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(cr)


def _trials() -> tuple[np.ndarray, list[dict[str, Any]]]:
    a = {
        "condition_labels": ["MS"],
        "treatment_types": ["DRUG"],
        "drugs": ["x"],
        "mechanisms": ["A"],
    }
    b = {"condition_labels": ["MS"], "treatment_types": ["DRUG"], "drugs": [], "mechanisms": []}
    c = {
        "condition_labels": ["Asthma"],
        "treatment_types": ["BEHAVIORAL"],
        "drugs": [],
        "mechanisms": [],
    }
    trials = [a, a, b, c, c, c]
    coords = np.array([[0, 0, 0]] * 3 + [[9, 9, 9]] * 3, dtype=float)
    return coords, trials


def test_cluster_table_denominators() -> None:
    coords, trials = _trials()
    rows = cr.cluster_table(coords, trials, 2)
    assert [r["size"] for r in rows] == [3, 3]
    ms = next(r for r in rows if r["disease"] == "MS")
    assert ms["mechanism"] == "A"
    assert ms["drug_members"] == 2
    assert ms["mechanism_share"] == 1.0  # of drug-bearing members, not all 3
    assert ms["top_drugs"] == ["x"]
    asthma = next(r for r in rows if r["disease"] == "Asthma")
    assert asthma["mechanism"] == "-"


def test_explorer_json_source(tmp_path: Path, capsys: Any) -> None:
    coords, trials = _trials()
    for t, (x, y, z) in zip(trials, coords, strict=True):
        t.update(x=float(x), y=float(y), z=float(z))
    p = tmp_path / "explorer.json"
    p.write_text(json.dumps({"trials": trials}))
    out = cr._from_explorer_json(p, 2, 42)
    assert "published layout" in out[0]
    assert "MS" in out[0]


def test_explorer_json_source_rejects_several_weights(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: Any
) -> None:
    p = tmp_path / "explorer.json"
    p.write_text(json.dumps({"trials": []}))
    monkeypatch.setattr("sys.argv", ["cluster_report.py", str(p), "--weight-mechanism", "0.5", "1"])
    with pytest.raises(SystemExit) as exc:
        cr.main()
    assert exc.value.code == 2
    assert "weight" in capsys.readouterr().err
