"""Evaluation harness: replay recordings offline, prompt-hash gate, report and gates, pairs."""

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml
from eval_report import assert_hash_current, build_report, check_gates
from eval_report import main as report_main
from make_synthetic_recording import fixture_http, scripted_model
from record_eval import PLACEHOLDER, record_pair
from record_eval import main as record_main

from diligence.config import load_config
from diligence.loop import RunRequest, run_agent
from diligence.model import ReplayMismatch, ReplayModel, read_lines
from diligence.recording import (
    RecordingTools,
    ReplayTools,
    comparable,
    meta_of,
    replay_run,
    stored_record,
)
from diligence.tools.registry_of_tools import ToolContext
from diligence.types import ToolResult

AGENT = Path(__file__).resolve().parents[1]
RECORDINGS = [*sorted((AGENT / "eval" / "recordings").glob("*.jsonl"))]
SYNTHETIC = AGENT / "tests" / "fixtures" / "recordings" / "synthetic.jsonl"
ALL = [*RECORDINGS, SYNTHETIC]


@pytest.mark.parametrize("path", ALL, ids=lambda p: p.name)
def test_replay_reproduces_each_recording(path: Path) -> None:
    replayed = replay_run(path, load_config())
    assert comparable(replayed) == comparable(stored_record(path))


@pytest.mark.parametrize("path", ALL, ids=lambda p: p.name)
def test_recordings_match_prompt_hash(path: Path) -> None:
    assert_hash_current(path, load_config())


def test_prompt_hash_mismatch_message(tmp_path: Path) -> None:
    bad = tmp_path / "x.jsonl"
    bad.write_text(json.dumps({"kind": "meta", "prompt_hash": "0" * 64}) + "\n")
    with pytest.raises(AssertionError, match="x.jsonl.*re-record the evaluation"):
        assert_hash_current(bad, load_config())


def test_synthetic_exercises_the_checker() -> None:
    rec = stored_record(SYNTHETIC)
    assert {v.verdict for v in rec.verdicts} == {"supported", "partly", "unsupported"}
    assert len(rec.removed) >= 1 and rec.status == "done" and rec.judgement_shown


def test_replay_tools_mismatch_and_exhaustion(tmp_path: Path) -> None:
    path = tmp_path / "t.jsonl"
    res = ToolResult(name="site_target", args={"target": "cd20"}, ids=["NCT90000001"])
    path.write_text(
        json.dumps(
            {
                "kind": "tool",
                "name": "site_target",
                "args": {"target": "cd20"},
                "result": res.model_dump(),
            }
        )
        + "\n"
    )
    ctx = ToolContext(http=httpx.Client(), base_url="x")
    tools = ReplayTools(path)
    with pytest.raises(ReplayMismatch, match="re-record the evaluation"):
        tools("site_target", {"target": "other"}, ctx)
    tools = ReplayTools(path)
    assert tools("site_target", {"target": "cd20"}, ctx) == res
    with pytest.raises(ReplayMismatch):
        tools("site_target", {"target": "cd20"}, ctx)


def test_recording_tools_writes_in_order(tmp_path: Path) -> None:
    path = tmp_path / "t.jsonl"

    def inner(name: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        return ToolResult(name=name, args=args, ids=["NCT90000001"])

    ctx = ToolContext(http=httpx.Client(), base_url="x")
    RecordingTools(inner, path)("site_target", {"a": 1}, ctx)
    (line,) = read_lines(path)
    assert line["kind"] == "tool" and line["name"] == "site_target" and line["args"] == {"a": 1}
    assert line["result"]["ids"] == ["NCT90000001"]


def test_replay_detects_drift(tmp_path: Path) -> None:
    lines = read_lines(SYNTHETIC)
    first_tool = next(i for i, x in enumerate(lines) if x["kind"] == "tool")
    lines[first_tool]["args"] = {"target": "changed", "disease": "MS"}
    bad = tmp_path / "bad.jsonl"
    bad.write_text("".join(json.dumps(x) + "\n" for x in lines))
    with pytest.raises(ReplayMismatch):
        replay_run(bad, load_config())


def test_recording_layout() -> None:
    lines = read_lines(SYNTHETIC)
    assert lines[0]["kind"] == "meta" and lines[-1]["kind"] == "result"
    assert {
        "prompt_hash",
        "agent_version",
        "target",
        "disease",
        "label",
        "fingerprint",
        "data_date",
        "recorded_at",
    } <= set(lines[0])
    kinds = {x["kind"] for x in lines}
    assert kinds == {"meta", "model", "tool", "result"}
    assert len(ReplayModel(SYNTHETIC)._calls) >= 4  # planner, writer and checker calls


# -- report -----------------------------------------------------------------------------------


def test_report_from_synthetic(tmp_path: Path) -> None:
    rec = tmp_path / "recs"
    rec.mkdir()
    (rec / "cd20__MS.jsonl").write_text(SYNTHETIC.read_text())
    labels = tmp_path / "labels.csv"
    labels.write_text("run,sentence_id,label,labeller,note\n")
    report = build_report(rec, labels, previous=None)
    assert report["n_runs"] == 1
    assert report["citation_validity"] == 1.0
    assert report["support_rate"] == pytest.approx(0.5)
    assert report["judgement_shown_rate"] == 1.0
    assert report["checker_agreement"] is None
    assert report["baseline"]["support_rate"] == report["support_rate"]
    assert report["agent_version"] == load_config().agent_version
    assert not check_gates(report)


def test_checker_agreement_from_labels(tmp_path: Path) -> None:
    rec = tmp_path / "recs"
    rec.mkdir()
    (rec / "cd20__MS.jsonl").write_text(SYNTHETIC.read_text())
    verdicts = {v.sentence_id: v.verdict for v in stored_record(SYNTHETIC).verdicts}
    ids = sorted(verdicts)
    labels = tmp_path / "labels.csv"
    rows = [f"cd20__MS,{ids[0]},{verdicts[ids[0]]},m,\n", f"cd20__MS,{ids[1]},unsupported,m,\n"]
    if verdicts[ids[1]] == "unsupported":
        rows[1] = f"cd20__MS,{ids[1]},supported,m,\n"
    labels.write_text("run,sentence_id,label,labeller,note\n" + "".join(rows))
    assert build_report(rec, labels, None)["checker_agreement"] == 0.5


def test_citation_validity_detects_unretrieved_cite(tmp_path: Path) -> None:
    lines = read_lines(SYNTHETIC)
    result = lines[-1]["record"]
    result["memo"]["sections"][0]["cites"] = ["NCT99999999"]
    rec = tmp_path / "recs"
    rec.mkdir()
    (rec / "a.jsonl").write_text("".join(json.dumps(x) + "\n" for x in lines))
    report = build_report(rec, tmp_path / "none.csv", None)
    assert report["citation_validity"] < 1.0
    assert any("citation_validity" in m for m in check_gates(report))


def test_baseline_carried_from_previous(tmp_path: Path) -> None:
    rec = tmp_path / "recs"
    rec.mkdir()
    (rec / "a.jsonl").write_text(SYNTHETIC.read_text())
    prev = {"baseline": {"support_rate": 0.9}}
    assert build_report(rec, tmp_path / "none.csv", prev)["baseline"] == {"support_rate": 0.9}


def test_report_gates() -> None:
    ok = {"citation_validity": 1.0, "support_rate": 0.8, "baseline": {"support_rate": 0.82}}
    assert check_gates(ok) == []
    assert check_gates({**ok, "citation_validity": 0.97})
    assert check_gates({**ok, "support_rate": 0.7})
    assert check_gates({**ok, "support_rate": 0.77}) == []
    committed = AGENT / "eval" / "report.json"
    if committed.exists():
        assert check_gates(json.loads(committed.read_text())) == []


def test_report_main_writes_and_keeps_baseline(tmp_path: Path) -> None:
    rec = tmp_path / "recs"
    rec.mkdir()
    (rec / "a.jsonl").write_text(SYNTHETIC.read_text())
    out = tmp_path / "report.json"
    out.write_text(json.dumps({"baseline": {"support_rate": 0.5}}))
    assert (
        report_main(
            ["--recordings", str(rec), "--labels", str(tmp_path / "l.csv"), "--out", str(out)]
        )
        == 0
    )
    assert json.loads(out.read_text())["baseline"] == {"support_rate": 0.5}


# -- pairs ------------------------------------------------------------------------------------


def test_pairs_structure() -> None:
    pairs = yaml.safe_load((AGENT / "eval" / "pairs.yaml").read_text())["pairs"]
    assert 15 <= len(pairs) <= 20
    keys = [(p["target"], p["disease"]) for p in pairs]
    assert len(set(keys)) == len(keys)
    for p in pairs:
        assert set(p) == {"target", "disease", "why"}
        assert all(isinstance(v, str) and v for v in p.values())
        assert "\n" not in p["why"]
    for must in [
        ("cd20", "all"),
        ("cd20", "MS"),
        ("fcrn", "MG"),
        ("c5", "MG"),
        ("cd19-car-t", "MG"),
    ]:
        assert must in keys


# -- record_eval ------------------------------------------------------------------------------


def test_record_pair_offline(tmp_path: Path) -> None:
    out, web = tmp_path / "rec", tmp_path / "web"
    cost = record_pair(
        "cd20",
        "MS",
        cfg=load_config(),
        model=scripted_model(),
        http=fixture_http(),
        base_url="https://example.test/data/",
        out_dir=out,
        web_dir=web,
    )
    assert cost == 0.0  # placeholder prices are zero
    rec = out / "cd20__MS.jsonl"
    assert meta_of(rec)["label"] == "CD20" and meta_of(rec)["data_date"] == "2026-11-04"
    assert comparable(replay_run(rec, load_config())) == comparable(stored_record(rec))
    published = json.loads((web / "cd20__MS.json").read_text())
    assert published["target"] == "cd20" and published["status"] == "done"


def test_record_eval_refuses_placeholders(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    assert PLACEHOLDER in load_config().models.writer  # shipped config still has placeholders
    code = record_main(["--pairs", str(AGENT / "eval" / "pairs.yaml"), "--out", str(tmp_path)])
    assert code == 2
    assert "placeholder" in capsys.readouterr().err.lower()


def test_run_agent_default_dispatch_unchanged() -> None:
    # dispatch_fn is optional; the real dispatcher remains the default.
    import inspect

    assert inspect.signature(run_agent).parameters["dispatch_fn"].default is None
    assert RunRequest("a", "b")
