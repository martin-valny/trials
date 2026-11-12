from pathlib import Path
from typing import Any

import pytest
import yaml

from trialradar.config import TRACKED_FIELDS, AreaConfig, ConfigError, Thresholds, load_config

REPO_YAML = Path(__file__).resolve().parents[3] / "config" / "area.yaml"


def test_repo_config_loads(cfg: AreaConfig) -> None:
    assert cfg.name == "neuroimmunology"
    assert len(cfg.conditions) == 6
    assert set(cfg.phases) == {"EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"}
    assert cfg.thresholds.enrollment_rel_change == 0.20
    assert cfg.thresholds.date_slip_days == 90
    assert cfg.thresholds.row_drop_warn == 0.10
    assert cfg.thresholds.row_drop_error == 0.25
    assert cfg.thresholds.min_relevant_share == 0.5
    assert cfg.aliases_dir.is_dir()
    assert tuple(cfg.tracked_fields) == TRACKED_FIELDS


@pytest.mark.parametrize(
    "patch",
    [
        {"phases": []},
        {"phases": ["PHASE5"]},
        {"study_type": "OBSERVATIONAL"},
        {"tracked_fields": ["not_a_field"]},
        {"surprise": 1},
    ],
)
def test_invalid_config_rejected(tmp_path: Path, patch: dict[str, Any]) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data.update(patch)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_config(path)


def test_threshold_defaults() -> None:
    t = Thresholds()
    assert (t.row_drop_warn, t.row_drop_error, t.min_relevant_share) == (0.10, 0.25, 0.5)


def test_bare_abbreviations_removed(cfg: AreaConfig) -> None:
    synonyms = {s for spec in cfg.conditions for s in spec.synonyms}
    assert not synonyms & {"MS", "MG", "Devic"}
    assert {"NMOSD", "MOGAD", "CIDP", "multiple sclerosis"} <= synonyms


@pytest.mark.parametrize(
    "thresholds",
    [
        {"row_drop_warn": 0.30, "row_drop_error": 0.25},
        {"row_drop_warn": 0.0},
        {"row_drop_error": 1.5},
        {"row_drop_warn": 0.10, "row_drop_error": 0.10, "min_relevant_share": -0.1},
        {"min_relevant_share": 1.1},
    ],
)
def test_invalid_thresholds_rejected(tmp_path: Path, thresholds: dict[str, Any]) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["thresholds"].update(thresholds)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_config(path)


def test_equal_warn_and_error_allowed(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["thresholds"].update({"row_drop_warn": 0.2, "row_drop_error": 0.2})
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    assert load_config(path).thresholds.row_drop_error == 0.2


def test_condition_requires_synonym(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["conditions"][0]["synonyms"] = []
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_config(path)


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"tracked_fields": []}, "must not be empty"),
        ({"tracked_fields": ["overall_status", "overall_status"]}, "duplicates"),
        ({"thresholds": {"date_slip_days": -5}}, "date_slip_days"),
        ({"thresholds": {"date_slip_days": 0}}, "date_slip_days"),
        ({"thresholds": {"enrollment_rel_change": 0}}, "enrollment_rel_change"),
        ({"thresholds": {"enrollment_rel_change": -0.2}}, "enrollment_rel_change"),
        ({"thresholds": {"max_null_rate": 1.5}}, "max_null_rate"),
        ({"thresholds": {"max_null_rate": -0.1}}, "max_null_rate"),
        ({"conditions": [{"label": "X", "synonyms": ["ok", ""]}]}, "must not be empty"),
        ({"conditions": [{"label": "X", "synonyms": ["  "]}]}, "whitespace-only"),
        ({"conditions": [{"label": " ", "synonyms": ["ok"]}]}, "label must not be blank"),
    ],
)
def test_invalid_values_rejected_with_a_reason(
    tmp_path: Path, patch: dict[str, Any], message: str
) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data.update(patch)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError, match=message):
        load_config(path)


def test_config_dirs_resolve_relative_to_file(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data.pop("approaches_dir", None)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    cfg = load_config(path)
    assert cfg.approaches_dir == (tmp_path / "approaches").resolve()
    assert cfg.mechanisms_dir == (tmp_path / "mechanisms").resolve()


def test_explorer_defaults_when_block_absent(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data.pop("explorer", None)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    cfg = load_config(path)
    assert cfg.explorer.k == 10
    assert cfg.explorer.weights["molecule"] == 1.0


def test_explorer_partial_weights_fill_defaults(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["explorer"] = {"weights": {"population": 0.5}}
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    weights = load_config(path).explorer.weights
    assert weights["population"] == 0.5
    assert weights["disease"] == 1.0


def test_explorer_rejects_negative_weight(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["explorer"] = {"weights": {"disease": -0.1}}
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_config(path)


def test_condition_code_optional_and_not_blank(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["conditions"][1].pop("code", None)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    assert load_config(path).conditions[1].code is None
    data["conditions"][1]["code"] = "  "
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_config(path)


def test_area_yaml_codes(cfg: AreaConfig) -> None:
    assert [c.code for c in cfg.conditions] == ["MS", "NMOSD", "MOGAD", "MG", "CIDP", "AE"]


def test_pipeline_paths_resolve_relative(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    for key in ("pipeline_dir", "sponsors_dir", "stop_reasons"):
        data.pop(key, None)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    cfg = load_config(path)
    assert cfg.pipeline_dir == (tmp_path / "pipeline").resolve()
    assert cfg.sponsors_dir == (tmp_path / "sponsors").resolve()
    assert cfg.stop_reasons == (tmp_path / "stop_reasons.csv").resolve()


def _write_with_condition(tmp_path: Path, **extra: Any) -> Path:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["conditions"][0].pop("approvals", None)
    data["conditions"][0].update(extra)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    return path


def test_condition_approvals_parsed(tmp_path: Path) -> None:
    approvals = {
        "mesh": ["Some Heading"],
        "efo": [["Parent Term", "child term"]],
        "label_terms": ["some label"],
    }
    cfg = load_config(_write_with_condition(tmp_path, approvals=approvals))
    terms = cfg.conditions[0].approvals
    assert terms is not None
    assert terms.mesh == ["Some Heading"]
    assert terms.efo == [("Parent Term", "child term")]
    assert isinstance(terms.efo[0], tuple)
    assert terms.label_terms == ["some label"]


def test_condition_without_approvals_is_none(tmp_path: Path) -> None:
    cfg = load_config(_write_with_condition(tmp_path))
    assert cfg.conditions[0].approvals is None


@pytest.mark.parametrize(
    "approvals",
    [
        {"mesh": ["ok", " "]},
        {"efo": [["ok", ""]]},
        {"efo": [[" ", "ok"]]},
        {"label_terms": [""]},
    ],
)
def test_approval_terms_reject_blank(tmp_path: Path, approvals: dict[str, Any]) -> None:
    with pytest.raises(ConfigError):
        load_config(_write_with_condition(tmp_path, approvals=approvals))


def test_approvals_dir_resolves_relative(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data.pop("approvals_dir", None)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    assert load_config(path).approvals_dir == (tmp_path / "approvals").resolve()


def test_repo_area_has_approvals(cfg: AreaConfig) -> None:
    by_code = {c.code: c.approvals for c in cfg.conditions}
    ms = by_code["MS"]
    assert ms is not None
    assert ms.mesh == [
        "Multiple Sclerosis",
        "Multiple Sclerosis, Chronic Progressive",
        "Multiple Sclerosis, Relapsing-Remitting",
    ]
    mogad = by_code["MOGAD"]
    assert mogad is not None
    assert mogad.mesh == []
    assert "myelin oligodendrocyte glycoprotein antibody" in mogad.label_terms
    ae = by_code["AE"]
    assert ae is not None
    assert ae.efo == [("Autoimmune Diseases of the Nervous System", "autoimmune encephalitis")]


def test_risk_config_defaults_and_resolves_dir(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data.pop("risk", None)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    cfg = load_config(path)
    assert cfg.risk.enabled is True
    assert cfg.risk.per_trial is True
    assert cfg.risk.dir == (tmp_path / "risk").resolve()


@pytest.mark.parametrize("field", ["label", "code"])
def test_duplicate_condition_label_or_code_rejected(tmp_path: Path, field: str) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    coded = [c for c in data["conditions"] if c.get("code")]
    coded[1][field] = coded[0][field]
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_config(path)


def test_codes_for_is_figure_ordered_and_deduplicated(cfg: AreaConfig) -> None:
    codes = list(cfg.disease_codes().values())
    labels = list(cfg.disease_codes())
    assert cfg.codes_for([labels[1], "Unknown", labels[0], labels[1]]) == codes[:2]


def test_label_defaults_to_none(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data.pop("label", None)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    assert load_config(path).label is None


def test_label_must_not_be_blank(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["label"] = "  "
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError, match="label must not be blank"):
        load_config(path)
