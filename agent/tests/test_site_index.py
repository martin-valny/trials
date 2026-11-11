"""The recorded-runs index the site reads, and the two scripts that rebuild it."""

import csv
import json
from pathlib import Path
from typing import Any

import record_eval
from eval_report import main as report_main
from make_synthetic_recording import fixture_http, scripted_model
from site_index import write_index

from diligence.config import load_config

AGENT = Path(__file__).resolve().parents[1]
SYNTHETIC = AGENT / "tests" / "fixtures" / "recordings" / "synthetic.jsonl"


def _memo(web: Path, name: str, target: str, disease: str, status: str = "done") -> None:
    web.mkdir(parents=True, exist_ok=True)
    (web / name).write_text(json.dumps({"target": target, "disease": disease, "status": status}))


def test_lists_done_memos_sorted(tmp_path: Path) -> None:
    _memo(tmp_path, "cd20__MS.json", "cd20", "MS")
    _memo(tmp_path, "btk__MS.json", "btk", "MS")
    (tmp_path / "eval-report.json").write_text("{}")
    (tmp_path / "index.json").write_text('{"runs": [{"target": "old", "disease": "x"}]}')
    assert write_index(tmp_path) == 2
    assert json.loads((tmp_path / "index.json").read_text()) == {
        "runs": [{"target": "btk", "disease": "MS"}, {"target": "cd20", "disease": "MS"}]
    }


def test_skips_failed_and_unreadable(tmp_path: Path) -> None:
    _memo(tmp_path, "a__MS.json", "a", "MS")
    _memo(tmp_path, "b__MS.json", "b", "MS", status="failed")
    (tmp_path / "c__MS.json").write_text("{not json")
    assert write_index(tmp_path) == 1
    runs = json.loads((tmp_path / "index.json").read_text())["runs"]
    assert runs == [{"target": "a", "disease": "MS"}]


def test_skips_records_without_a_named_target_or_disease(tmp_path: Path) -> None:
    for name, target, disease in [
        ("a__MS.json", "a", "MS"),
        ("b__MS.json", None, "MS"),
        ("c__x.json", "c", None),
        ("d__MS.json", "", "MS"),
        ("e__1.json", "e", 1),
    ]:
        (tmp_path / name).write_text(
            json.dumps({"target": target, "disease": disease, "status": "done"})
        )
    assert write_index(tmp_path) == 1
    assert json.loads((tmp_path / "index.json").read_text())["runs"] == [
        {"target": "a", "disease": "MS"}
    ]


def test_empty_dir_writes_empty_runs(tmp_path: Path) -> None:
    assert write_index(tmp_path) == 0
    assert json.loads((tmp_path / "index.json").read_text()) == {"runs": []}


def test_record_all_rebuilds_index_even_when_gates_fail(tmp_path: Path) -> None:
    cfg = load_config().model_copy(update={"site_base_url": "https://example.test/data/"})
    out, web = tmp_path / "eval" / "recordings", tmp_path / "web"
    out.parent.mkdir()
    # A perfect baseline makes the scripted run's mixed verdicts fail the support gate.
    (tmp_path / "eval" / "report.json").write_text(json.dumps({"baseline": {"support_rate": 1.0}}))
    code = record_eval.record_all(
        [{"target": "cd20", "disease": "MS"}],
        cfg=cfg,
        model=scripted_model(),
        http=fixture_http(),
        out_dir=out,
        web_dir=web,
    )
    assert code == 1
    assert json.loads((web / "index.json").read_text()) == {
        "runs": [{"target": "cd20", "disease": "MS"}]
    }
    assert not (web / "eval-report.json").exists()


def _recordings(tmp_path: Path) -> Path:
    recs = tmp_path / "recs"
    recs.mkdir()
    (recs / "synthetic.jsonl").write_text(SYNTHETIC.read_text())
    return recs


def _run_report(tmp_path: Path, baseline: dict[str, Any] | None) -> tuple[int, Path]:
    tmp_path.mkdir(parents=True)
    web = tmp_path / "web"
    out = tmp_path / "report.json"
    if baseline is not None:
        out.write_text(json.dumps({"baseline": baseline}))
    labels = tmp_path / "labels.csv"
    with labels.open("w", newline="") as f:
        csv.writer(f).writerow(["run", "sentence_id", "label"])
    _memo(web, "cd20__MS.json", "cd20", "MS")
    code = report_main(
        [
            "--recordings", str(_recordings(tmp_path)),
            "--labels", str(labels),
            "--out", str(out),
            "--web-dir", str(web),
        ]
    )  # fmt: skip
    return code, web


def test_eval_report_web_dir_copies_and_indexes(tmp_path: Path) -> None:
    code, web = _run_report(tmp_path / "pass", None)
    assert code == 0
    assert (web / "eval-report.json").exists() and (web / "index.json").exists()

    code, web = _run_report(tmp_path / "fail", {"support_rate": 1.0})
    assert code == 1
    assert (web / "index.json").exists() and not (web / "eval-report.json").exists()
