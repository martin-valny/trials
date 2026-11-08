from pathlib import Path

import pytest

from trialradar.pipeline_figure.io import (
    FigureConfig,
    norm_sponsor,
    read_figure_config,
)

ROOT = Path(__file__).resolve().parents[3]

ROWS_HEAD = "row_id,label,sub,family,family_order,row_order,classes,drugs,gene,blurb,related\n"


def _write(tmp: Path, *, rows: str | None = None, **overrides: str) -> FigureConfig:
    pipe, spons = tmp / "pipeline", tmp / "sponsors"
    pipe.mkdir(exist_ok=True)
    spons.mkdir(exist_ok=True)
    files = {
        pipe / "rows.csv": ROWS_HEAD + (rows or "a,A,s,F,1,1,cls-a,,G,b,\n"),
        pipe / "unrowed.csv": "class,reason\nx,symptomatic\n",
        pipe / "background.csv": "drug,reason\nfludarabine,chemo\n",
        spons / "parents.csv": "sponsor,parent,kind\nGenentech,Roche,industry\n",
        tmp / "stop_reasons.csv": "pattern,group\nsafety,Safety\n",
    }
    for path, text in files.items():
        key = path.name
        path.write_text(overrides.get(key, text))
    return read_figure_config(pipe, spons, tmp / "stop_reasons.csv")


def test_reads_committed_config() -> None:
    cfg = read_figure_config(
        ROOT / "config/pipeline", ROOT / "config/sponsors", ROOT / "config/stop_reasons.csv"
    )
    assert len(cfg.rows) >= 22
    assert [f.order for f in cfg.families] == list(range(1, 10))
    assert cfg.rows[0].id == "cd20"
    assert cfg.families[0].id == "b-cell-depletion"
    assert cfg.families[0].label == "B-cell depletion"
    assert cfg.rows[0].family == "b-cell-depletion"
    assert cfg.families[1].id == "igg-and-complement"
    assert "fludarabine" in cfg.background
    assert cfg.parents[norm_sponsor("Genentech, Inc.")].parent == "Roche"
    assert cfg.parents[norm_sponsor("Novartis Pharmaceuticals")].parent == "Novartis"
    assert cfg.parents[norm_sponsor("University of Rochester")].kind == "academic"


def test_minimal_config_reads(tmp_path: Path) -> None:
    cfg = _write(tmp_path)
    assert cfg.rows[0].gene == "G" and cfg.rows[0].classes == ("cls-a",)
    assert cfg.reasons[0].pattern.search("SAFETY signal")


def test_rejects_duplicate_row_id(tmp_path: Path) -> None:
    rows = "a,A,s,F,1,1,c1,,,b,\na,B,s,F,1,2,c2,,,b,\n"
    with pytest.raises(ValueError, match=r"^rows\.csv:3: duplicate row_id"):
        _write(tmp_path, rows=rows)


def test_rejects_class_in_two_rows(tmp_path: Path) -> None:
    rows = "a,A,s,F,1,1,c1;c2,,,b,\nb,B,s,F,1,2,c2,,,b,\n"
    with pytest.raises(ValueError, match=r"^rows\.csv:3: class 'c2' is in two rows"):
        _write(tmp_path, rows=rows)


def test_rejects_drug_in_two_rows(tmp_path: Path) -> None:
    rows = "a,A,s,F,1,1,,d1,,b,\nb,B,s,F,1,2,,d1,,b,\n"
    with pytest.raises(ValueError, match=r"^rows\.csv:3: drug 'd1' is in two rows"):
        _write(tmp_path, rows=rows)


def test_rejects_unknown_related(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"^rows\.csv:2: .*related 'nope'"):
        _write(tmp_path, rows="a,A,s,F,1,1,c1,,,b,nope\n")


def test_rejects_bad_row_id(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"^rows\.csv:2: row_id 'Bad_Id'"):
        _write(tmp_path, rows="Bad_Id,A,s,F,1,1,c1,,,b,\n")


def test_rejects_bad_kind(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"^parents\.csv:2: kind 'pharma'"):
        _write(tmp_path, **{"parents.csv": "sponsor,parent,kind\nX,Y,pharma\n"})


def test_rejects_duplicate_normalised_sponsor(tmp_path: Path) -> None:
    text = "sponsor,parent,kind\nArgenx BV.,argenx,industry\nargenx  bv,argenx,industry\n"
    with pytest.raises(ValueError, match=r"^parents\.csv:3: duplicate sponsor"):
        _write(tmp_path, **{"parents.csv": text})


def test_rejects_bad_group(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"^stop_reasons\.csv:2: group 'Not given'"):
        _write(tmp_path, **{"stop_reasons.csv": "pattern,group\nx,Not given\n"})


def test_rejects_bad_regex(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"^stop_reasons\.csv:2: bad regex"):
        _write(tmp_path, **{"stop_reasons.csv": "pattern,group\n(unclosed,Safety\n"})


def test_missing_file_raises_file_not_found(tmp_path: Path) -> None:
    _write(tmp_path)
    (tmp_path / "pipeline" / "background.csv").unlink()
    with pytest.raises(FileNotFoundError):
        read_figure_config(
            tmp_path / "pipeline", tmp_path / "sponsors", tmp_path / "stop_reasons.csv"
        )


def test_norm_sponsor() -> None:
    assert norm_sponsor("  Novartis   Pharmaceuticals. ") == "novartis pharmaceuticals"
    assert norm_sponsor("Genentech, Inc.") == "genentech, inc"
