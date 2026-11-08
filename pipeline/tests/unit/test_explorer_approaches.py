"""Per-trial approaches, the drug index and the R19 skip (spec 2026-11-08 §6.3)."""

from __future__ import annotations

import shutil
from pathlib import Path

from trialradar.approaches.io import read_approaches
from trialradar.approaches.sort import TrialApproaches
from trialradar.config import AreaConfig
from trialradar.explorer.approaches import drug_index, load_trial_approaches, mapping_names
from trialradar.explorer.extras import ExperimentalIntervention, StudyExtras
from trialradar.mechanisms.io import DrugMapping, Status

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
APPROACHES = FIXTURES / "approaches"
EMPTY = TrialApproaches((), (), (), ())


def _row(
    drug: str,
    status: Status = "mapped",
    cls: tuple[str, ...] = (),
    targets: tuple[str, ...] = (),
    modality: str | None = None,
) -> DrugMapping:
    return DrugMapping(
        drug=drug,
        status=status,
        chembl_id=None,
        modality=modality,
        mechanism_class=cls,
        mechanism=(),
        action_type=(),
        targets=targets,
    )


def _study(nct: str, *ivs: tuple[str, str], drugs: tuple[str, ...] = ()) -> StudyExtras:
    return StudyExtras(
        nct_id=nct,
        brief_summary=None,
        sex=None,
        min_age_years=None,
        max_age_years=None,
        has_results=False,
        experimental_drugs=drugs,
        mesh_terms=(),
        condition_labels=(),
        experimental_interventions=tuple(ExperimentalIntervention(t, n, "") for t, n in ivs),
    )


def _mech_dir(tmp_path: Path, rows: str) -> Path:
    d = tmp_path / "mechanisms"
    d.mkdir()
    (d / "drugs.csv").write_text(
        "drug,status,chembl_id,modality,mechanism_class,mechanism,action_type,targets\n" + rows,
        encoding="utf-8",
    )
    return d


MECH_ROWS = (
    "ocrelizumab,mapped,,antibody,anti-CD20,,,MS4A1\n"
    "cyclophosphamide,manual,,small molecule,DNA inhibitor,,,\n"
    "mesenchymal stem cells,manual,,cell therapy,msc,,,\n"
    "vitamin d,manual,,small molecule,VDR agonist,,,VDR\n"
    "influenza vaccine,not_a_drug,,,,,,\n"
    "mystery-101,unmapped,,,,,,\n"
)

FULL = {
    "N1": _study("N1", ("DRUG", "Ocrelizumab 600 mg"), ("DRUG", "Placebo"), drugs=("Ocrelizumab",)),
    "N2": _study(
        "N2",
        ("BIOLOGICAL", "Mesenchymal stem cells"),
        ("DRUG", "Cyclophosphamide"),
        drugs=("Mesenchymal stem cells", "Cyclophosphamide"),
    ),
    "N3": _study("N3", ("BEHAVIORAL", "Aerobic training"), ("DEVICE", "Wristband")),
    "N4": _study("N4", ("OTHER", "Standard therapy")),
    "N5": _study("N5", ("DRUG", "mystery-101"), ("DRUG", "Ocrelizumab"), drugs=("mystery-101",)),
    "N6": _study("N6", ("DIETARY_SUPPLEMENT", "Vitamin D")),
    "N7": _study("N7"),
}


def _cfg(cfg: AreaConfig, tmp_path: Path, approaches: Path = APPROACHES) -> AreaConfig:
    return cfg.model_copy(
        update={"mechanisms_dir": _mech_dir(tmp_path, MECH_ROWS), "approaches_dir": approaches}
    )


def test_trials_get_approaches_kinds_and_unsorted(cfg: AreaConfig, tmp_path: Path) -> None:
    warnings: list[str] = []
    out, acfg = load_trial_approaches(_cfg(cfg, tmp_path), FULL, {}, warnings)
    assert acfg is not None and "msc" in acfg.kinds
    assert warnings == []
    assert out["N1"] == TrialApproaches(("targeted",), (), ("anti-CD20",), ())
    assert out["N2"].approaches == ("targeted", "cell")
    assert out["N2"].kinds == ("msc",)
    assert out["N3"].approaches == ("nondrug",)
    assert out["N3"].kinds == ("exercise", "type:DEVICE")
    # Review focus 1: "standard therapy" (OTHER) is Not yet sorted with its name listed
    assert out["N4"] == TrialApproaches(
        ("unclassified",), ("type:OTHER",), (), ("standard therapy",)
    )
    # a mapped drug and an unmapped one: Targeted only, the unmapped name still listed
    assert out["N5"].approaches == ("targeted",)
    assert out["N5"].unsorted == ("mystery-101",)
    assert out["N6"].approaches == ("targeted",)
    # no experimental intervention left: Unclassified, never missing from the rail
    assert out["N7"].approaches == ("unclassified",)


def test_excluded_terms_are_dropped(cfg: AreaConfig, tmp_path: Path) -> None:
    full = {"N1": _study("N1", ("DRUG", "Placebo"), ("OTHER", "Usual care"))}
    out, _ = load_trial_approaches(_cfg(cfg, tmp_path), full, {}, [])
    assert out["N1"] == TrialApproaches(("unclassified",), (), (), ())


def test_missing_approach_files_give_one_warning(cfg: AreaConfig, tmp_path: Path) -> None:
    empty = tmp_path / "approaches"
    empty.mkdir()
    warnings: list[str] = []
    out, acfg = load_trial_approaches(_cfg(cfg, tmp_path, empty), FULL, {}, warnings)
    assert acfg is None
    assert out == {nct: EMPTY for nct in FULL}
    assert len(warnings) == 1 and warnings[0].startswith("approaches: ")


def test_collision_with_a_molecular_class_degrades(cfg: AreaConfig, tmp_path: Path) -> None:
    """A kind key used as the class of a row with targets is a collision (R19 skip)."""
    approaches = tmp_path / "approaches"
    shutil.copytree(APPROACHES, approaches)
    mech = tmp_path / "m2"
    mech.mkdir()
    (mech / "drugs.csv").write_text(
        "drug,status,chembl_id,modality,mechanism_class,mechanism,action_type,targets\n"
        "weird,mapped,,antibody,msc,,,CD1\n",
        encoding="utf-8",
    )
    c = cfg.model_copy(update={"mechanisms_dir": mech, "approaches_dir": approaches})
    warnings: list[str] = []
    out, acfg = load_trial_approaches(c, FULL, {}, warnings)
    assert acfg is None
    assert out == {nct: EMPTY for nct in FULL}
    assert len(warnings) == 1 and warnings[0].startswith("approaches: ")
    assert "msc" in warnings[0]


def test_no_target_kind_row_is_not_a_collision(cfg: AreaConfig, tmp_path: Path) -> None:
    warnings: list[str] = []
    _, acfg = load_trial_approaches(_cfg(cfg, tmp_path), FULL, {}, warnings)
    assert acfg is not None and warnings == []


def test_mapping_names_add_supplements_but_not_other_types(cfg: AreaConfig) -> None:
    names = mapping_names(FULL, {}, cfg)
    assert names["N1"] == frozenset({"ocrelizumab"})
    assert names["N3"] == frozenset()
    assert names["N6"] == frozenset({"vitamin d"})
    assert names["N2"] == frozenset({"mesenchymal stem cells", "cyclophosphamide"})


def test_drug_index_entries() -> None:
    acfg = read_approaches(APPROACHES)
    maps = {
        m.drug: m
        for m in (
            _row("ocrelizumab", cls=("anti-CD20",), targets=("MS4A1",), modality="antibody"),
            _row("cyclophosphamide", "manual", cls=("DNA inhibitor",), modality="small molecule"),
            _row(
                "thymo-cy",
                "manual",
                cls=("DNA inhibitor", "atg"),
                modality="protein;small molecule",
            ),
            _row("mesenchymal stem cells", "manual", cls=("msc",), modality="cell therapy"),
            _row("influenza vaccine", "not_a_drug"),
        )
    }
    idx = drug_index(
        ["ocrelizumab", "thymo-cy", "mesenchymal stem cells", "influenza vaccine", "nobody"],
        maps,
        acfg,
    )
    assert idx["ocrelizumab"] == {
        "mechanisms": ["anti-CD20"],
        "modalities": ["antibody"],
        "kinds": [],
        "approaches": ["targeted"],
    }
    assert idx["thymo-cy"] == {
        "mechanisms": ["DNA inhibitor"],
        "modalities": ["protein", "small molecule"],
        "kinds": ["atg"],
        "approaches": ["targeted", "plasma"],
    }
    assert idx["mesenchymal stem cells"]["approaches"] == ["cell"]
    assert idx["mesenchymal stem cells"]["mechanisms"] == []
    assert idx["influenza vaccine"] == {
        "mechanisms": [],
        "modalities": [],
        "kinds": ["not_a_treatment"],
        "approaches": ["unclassified"],
    }
    assert idx["nobody"]["approaches"] == ["unclassified"]
    assert list(idx) == sorted(idx)


def test_drug_index_uses_the_intervention_type() -> None:
    acfg = read_approaches(APPROACHES)
    idx = drug_index(["fish oil"], {}, acfg, types={"fish oil": "DIETARY_SUPPLEMENT"})
    assert idx["fish oil"]["kinds"] == ["type:DIETARY_SUPPLEMENT"]
    assert idx["fish oil"]["approaches"] == ["nondrug"]


def test_drug_index_without_approach_config() -> None:
    maps = {"m": _row("m", "manual", cls=("msc",), modality="cell therapy")}
    idx = drug_index(["m"], maps, None)
    assert idx["m"] == {
        "mechanisms": ["msc"],
        "modalities": ["cell therapy"],
        "kinds": [],
        "approaches": [],
    }


def test_combination_row_with_a_kind_part_is_not_a_collision(
    cfg: AreaConfig, tmp_path: Path
) -> None:
    """IVIG + methylprednisolone in one row: the targets belong to the steroid, so the
    ``immunoglobulin`` part is a kind and the trial is in both bubbles (spec §6.2)."""
    mech = tmp_path / "m3"
    mech.mkdir()
    (mech / "drugs.csv").write_text(
        "drug,status,chembl_id,modality,mechanism_class,mechanism,action_type,targets\n"
        "ivig + mp,manual,,protein;small molecule,"
        "immunoglobulin;glucocorticoid receptor modulator,,AGONIST,NR3C1\n",
        encoding="utf-8",
    )
    c = cfg.model_copy(update={"mechanisms_dir": mech, "approaches_dir": APPROACHES})
    full = {"N1": _study("N1", ("DRUG", "IVIG + MP"), drugs=("IVIG + MP",))}
    warnings: list[str] = []
    out, acfg = load_trial_approaches(c, full, {}, warnings)
    assert acfg is not None and warnings == []
    assert out["N1"].approaches == ("targeted", "plasma")
    assert out["N1"].kinds == ("immunoglobulin",)
