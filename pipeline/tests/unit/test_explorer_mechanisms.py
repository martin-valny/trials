"""Per-trial mechanism fields from the mapping files (R19)."""

from __future__ import annotations

from pathlib import Path

from trialradar.config import AreaConfig
from trialradar.explorer.mechanisms import TrialMechanisms, load_trial_mechanisms, trial_mechanisms
from trialradar.mechanisms.io import DrugMapping, read_mappings

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "mechanisms"


def _m(drug: str, status: str = "mapped", **kw: tuple[str, ...] | str | None) -> DrugMapping:
    base: dict[str, object] = {
        "chembl_id": None,
        "modality": None,
        "mechanism_class": (),
        "mechanism": (),
        "action_type": (),
        "targets": (),
    }
    base.update(kw)
    return DrugMapping(drug=drug, status=status, **base)  # type: ignore[arg-type]


def test_union_is_sorted_over_a_trials_drugs() -> None:
    maps = {
        "a": _m("a", mechanism_class=("z class",), targets=("T2",), modality="antibody"),
        "b": _m(
            "b", mechanism_class=("a class", "z class"), targets=("T1",), modality="small molecule"
        ),
    }
    out = trial_mechanisms({"N1": frozenset({"a", "b"}), "N2": frozenset()}, maps)
    assert out["N1"] == TrialMechanisms(
        ("a class", "z class"), ("T1", "T2"), ("antibody", "small molecule")
    )
    assert out["N2"] == TrialMechanisms((), (), ())


def test_not_a_drug_and_unmapped_contribute_nothing() -> None:
    maps = {
        "x": _m("x", "not_a_drug", mechanism_class=("c",), modality="m"),
        "y": _m("y", "unmapped", targets=("T",)),
    }
    out = trial_mechanisms({"N1": frozenset({"x", "y", "missing"})}, maps)
    assert out["N1"] == TrialMechanisms((), (), ())


def test_override_wins_when_loaded() -> None:
    out = trial_mechanisms({"N1": frozenset({"example drug"})}, read_mappings(FIXTURES))
    assert out["N1"] == TrialMechanisms(("anti-CD20",), ("MS4A1",), ("antibody",))


def test_missing_dir_gives_empty_fields_and_one_warning(cfg: AreaConfig, tmp_path: Path) -> None:
    cfg = cfg.model_copy(update={"mechanisms_dir": tmp_path / "nope"})
    warnings: list[str] = []
    out = load_trial_mechanisms(cfg, {"N1": frozenset({"a"})}, warnings)
    assert out == {"N1": TrialMechanisms()}
    assert len(warnings) == 1 and warnings[0].startswith("explorer_mechanisms: ")


def test_malformed_csv_gives_empty_fields_and_one_warning(cfg: AreaConfig, tmp_path: Path) -> None:
    (tmp_path / "drugs.csv").write_text("drug,status\na,mapped\n", encoding="utf-8")
    cfg = cfg.model_copy(update={"mechanisms_dir": tmp_path})
    warnings: list[str] = []
    out = load_trial_mechanisms(cfg, {"N1": frozenset({"a"})}, warnings)
    assert out == {"N1": TrialMechanisms()}
    assert len(warnings) == 1 and warnings[0].startswith("explorer_mechanisms: ")


def test_unmapped_warning_counts_drugs_and_trials(cfg: AreaConfig) -> None:
    cfg = cfg.model_copy(update={"mechanisms_dir": FIXTURES})
    drugs = {
        "N1": frozenset({"dimethyl fumarate", "no row"}),
        "N2": frozenset({"no row", "other"}),
        "N3": frozenset({"dimethyl fumarate"}),
    }
    warnings: list[str] = []
    load_trial_mechanisms(cfg, drugs, warnings)
    assert warnings == ["mechanism_unmapped: 2 drugs (2 trials)"]


def test_min_group_must_be_positive() -> None:
    import pytest
    from pydantic import ValidationError

    from trialradar.config import ExplorerConfig

    with pytest.raises(ValidationError):
        ExplorerConfig(min_group=0)
    assert ExplorerConfig().min_group == 10
