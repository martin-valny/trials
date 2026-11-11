"""config/approaches reading and validation."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from trialradar.approaches.io import (
    APPROACH_LABELS,
    APPROACHES,
    REQUIRED_KINDS,
    check_collisions,
    read_approaches,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "approaches"


@pytest.fixture
def cfg_dir(tmp_path: Path) -> Path:
    for name in ("kinds.csv", "nondrug_rules.csv"):
        shutil.copy(FIXTURES / name, tmp_path / name)
    return tmp_path


def _edit(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    assert old in text
    path.write_text(text.replace(old, new))


def _drop_line(path: Path, start: str) -> None:
    lines = path.read_text().splitlines(keepends=True)
    kept = [ln for ln in lines if not ln.startswith(start)]
    assert len(kept) == len(lines) - 1
    path.write_text("".join(kept))


def test_vocabulary_is_verbatim() -> None:
    assert APPROACHES == (
        "targeted",
        "cell",
        "plasma",
        "tolerisation",
        "diffuse",
        "nondrug",
        "unclassified",
    )
    assert APPROACH_LABELS == {
        "targeted": "Targeted drugs",
        "cell": "Cell & transplant",
        "plasma": "Antibody & plasma",
        "tolerisation": "Tolerisation",
        "diffuse": "Broad immunomodulators",
        "nondrug": "Non-drug care",
        "unclassified": "Unclassified",
    }
    assert "not_a_treatment" in REQUIRED_KINDS
    assert "type:OTHER" in REQUIRED_KINDS
    assert len(REQUIRED_KINDS) == 12


def test_reads_fixture_config() -> None:
    cfg = read_approaches(FIXTURES)
    assert len(cfg.kinds) == 21
    assert len(cfg.rules) == 8
    assert cfg.kinds["msc"].approach == "cell"
    assert cfg.kinds["msc"].group == "Mesenchymal cells"
    assert cfg.kinds["msc"].rationale.startswith("Proposed")
    tms = next(r for r in cfg.rules if r.pattern == "transcranial magnetic")
    assert tms.types == frozenset({"DEVICE", "PROCEDURE"})
    assert tms.kind == "tms"
    assert next(r for r in cfg.rules if r.pattern == "exercise").types == frozenset()


def test_rule_patterns_are_casefolded(cfg_dir: Path) -> None:
    _edit(cfg_dir / "nondrug_rules.csv", "plasmapheresis,", "PlasmaPheresis,")
    cfg = read_approaches(cfg_dir)
    assert any(r.pattern == "plasmapheresis" for r in cfg.rules)


@pytest.mark.parametrize("name", ["kinds.csv", "nondrug_rules.csv"])
def test_missing_file_raises(cfg_dir: Path, name: str) -> None:
    (cfg_dir / name).unlink()
    with pytest.raises(ValueError, match=name):
        read_approaches(cfg_dir)


def test_missing_column_raises(cfg_dir: Path) -> None:
    _edit(cfg_dir / "kinds.csv", ",source_url\n", "\n")
    with pytest.raises(ValueError, match="source_url"):
        read_approaches(cfg_dir)


def test_unknown_approach_raises(cfg_dir: Path) -> None:
    _edit(cfg_dir / "kinds.csv", "msc,cell,", "msc,cells,")
    with pytest.raises(ValueError, match="cells"):
        read_approaches(cfg_dir)


def test_duplicate_kind_raises(cfg_dir: Path) -> None:
    with (cfg_dir / "kinds.csv").open("a") as f:
        f.write("msc,cell,Mesenchymal cells,MSC again,Proposed x,https://example.org\n")
    with pytest.raises(ValueError, match="duplicate"):
        read_approaches(cfg_dir)


def test_rule_with_unknown_kind_raises(cfg_dir: Path) -> None:
    _edit(cfg_dir / "nondrug_rules.csv", "exercise,,exercise", "exercise,,yoga")
    with pytest.raises(ValueError, match="yoga"):
        read_approaches(cfg_dir)


def test_missing_required_kind_raises(cfg_dir: Path) -> None:
    _drop_line(cfg_dir / "kinds.csv", "type:OTHER,")
    with pytest.raises(ValueError, match="type:OTHER"):
        read_approaches(cfg_dir)


def test_kind_without_source_url_raises(cfg_dir: Path) -> None:
    _edit(cfg_dir / "kinds.csv", ",https://example.org/glatiramer", ",")
    with pytest.raises(ValueError, match="glatiramer"):
        read_approaches(cfg_dir)


def test_unclassified_kind_needs_a_known_group(cfg_dir: Path) -> None:
    _edit(
        cfg_dir / "kinds.csv",
        "type:OTHER,unclassified,Not yet sorted",
        "type:OTHER,unclassified,Misc",
    )
    with pytest.raises(ValueError, match="Misc"):
        read_approaches(cfg_dir)


def test_kind_cannot_be_targeted(cfg_dir: Path) -> None:
    _edit(cfg_dir / "kinds.csv", "glatiramer,diffuse,", "glatiramer,targeted,")
    with pytest.raises(ValueError, match="targeted"):
        read_approaches(cfg_dir)


def test_empty_rule_pattern_raises(cfg_dir: Path) -> None:
    _edit(cfg_dir / "nondrug_rules.csv", "exercise,,exercise", " ,,exercise")
    with pytest.raises(ValueError, match="pattern"):
        read_approaches(cfg_dir)


def test_collision_with_molecular_class_raises() -> None:
    cfg = read_approaches(FIXTURES)
    with pytest.raises(ValueError, match="msc"):
        check_collisions(cfg, {"msc"})
    check_collisions(cfg, {"anti-CD20", "DNA inhibitor"})
