"""Evaluation harness: replay recordings offline, prompt-hash gate, report and gates, pairs."""

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import record_eval
import yaml
from eval_report import assert_hash_current, build_report, check_gates
from eval_report import main as report_main
from make_synthetic_recording import fixture_http, scripted_model
from record_eval import main as record_main
from record_eval import record_pair

from diligence.config import AgentConfig, Models, Price, load_config
from diligence.loop import RunRequest
from diligence.model import ReplayMismatch, ReplayModel, read_lines
from diligence.recording import (
    RecordingTools,
    ReplayClock,
    ReplayTools,
    comparable,
    meta_of,
    record_run,
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


def test_synthetic_keeps_a_summary_count_and_a_percent_from_p() -> None:
    """I2/R37 in CI: "14" comes from site_risk's summary, "24%" from p 0.244."""
    rec = stored_record(SYNTHETIC)
    assert rec.memo is not None
    kept = {s.id: s.text for s in rec.memo.sections}
    assert "s5" in kept and "14 trials" in kept["s5"] and "24%" in kept["s5"]
    assert all(r["sentence_id"] != "s5" for r in rec.removed)


class _Ticking:
    """A clock that jumps forward 50 s on every reading."""

    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        self.t += 50.0
        return self.t


def test_time_limited_run_replays(tmp_path: Path) -> None:
    """I6/R41: the recorded clock readings are fed back, so the time limit replays the same."""
    path = tmp_path / "slow.jsonl"
    http = fixture_http()
    rec = record_run(
        path,
        req=RunRequest("cd20", "MS"),
        cfg=load_config(),
        model=scripted_model(),
        ctx=ToolContext(http=http, base_url="https://example.test/data/"),
        fingerprint="fp",
        data_date="2026-11-04",
        label="CD20",
        clock=_Ticking(),
    )
    assert any(s.kind == "limit" and "time" in s.text for s in rec.steps)
    clocks = [x["t"] for x in read_lines(path) if x["kind"] == "clock"]
    assert clocks[0] == 0.0 and clocks == sorted(clocks)
    replayed = replay_run(path, load_config())
    assert comparable(replayed) == comparable(stored_record(path))


def test_replay_clock_exhaustion_is_a_mismatch(tmp_path: Path) -> None:
    path = tmp_path / "c.jsonl"
    path.write_text(json.dumps({"kind": "clock", "t": 0.0}) + "\n")
    clock = ReplayClock(path)
    assert clock() == 0.0
    with pytest.raises(ReplayMismatch, match="re-record the evaluation"):
        clock()


def test_model_lines_store_messages_as_a_delta() -> None:
    """Minor 16: each model line stores only the messages the previous request did not have."""
    lines = [x for x in read_lines(SYNTHETIC) if x["kind"] == "model"]
    planner2, writer = lines[1]["request"], lines[2]["request"]
    assert "messages" not in planner2
    assert lines[0]["request"]["messages_prefix"] == 0
    assert planner2["messages_prefix"] >= 1 and writer["messages_prefix"] >= 3
    total = sum(len(json.dumps(x["request"]["messages_tail"])) for x in lines)
    assert total < len(SYNTHETIC.read_text())


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
    assert kinds == {"meta", "model", "tool", "clock", "result"}
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
    assert report["support_rate"] == pytest.approx(0.6)  # 3 of 5 checked
    assert report["unretrieved_removal_rate"] == 0.0  # Minor 15: the before-check rate
    assert report["judgement_shown_rate"] == 1.0
    assert report["checker_agreement"] is None
    assert report["baseline"]["support_rate"] == report["support_rate"]
    assert report["agent_version"] == load_config().agent_version
    assert not check_gates(report)


def test_checker_agreement_from_labels(tmp_path: Path) -> None:
    rec = tmp_path / "recs"
    rec.mkdir()
    (rec / "cd20__MS.jsonl").write_text(SYNTHETIC.read_text())
    labels = tmp_path / "labels.csv"
    # Synthetic verdicts: s1 supported, s2 partly. One label agrees, one does not.
    labels.write_text(
        "run,sentence_id,label,labeller,note\ncd20__MS,s1,supported,m,\ncd20__MS,s2,supported,m,\n"
    )
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


def _cfg_with(models: str, price: float) -> AgentConfig:
    cfg = load_config()
    ids = {k: f"{models}-{k}" for k in cfg.models.model_dump()}
    return cfg.model_copy(
        update={
            "models": Models(**ids),
            "prices": {i: Price(input_per_mtok=price, output_per_mtok=price) for i in ids.values()},
        }
    )


@pytest.mark.parametrize(
    ("cfg", "word"),
    [(_cfg_with("REPLACE_WITH_X", 1.0), "placeholder"), (_cfg_with("real", 0.0), "price")],
)
def test_record_eval_refuses_placeholders(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    cfg: AgentConfig,
    word: str,
) -> None:
    monkeypatch.setattr(record_eval, "load_config", lambda: cfg)
    code = record_main(["--pairs", str(AGENT / "eval" / "pairs.yaml"), "--out", str(tmp_path)])
    assert code == 2
    assert word in capsys.readouterr().err.lower()


def test_report_recomputed_from_committed_recordings() -> None:
    if not RECORDINGS:
        pytest.skip("no recordings yet")
    committed_path = AGENT / "eval" / "report.json"
    assert committed_path.exists(), "recordings exist but eval/report.json was not committed"
    committed = json.loads(committed_path.read_text())
    fresh = build_report(AGENT / "eval" / "recordings", AGENT / "eval" / "labels.csv", committed)
    assert check_gates(fresh) == []
    assert committed["n_runs"] == len(RECORDINGS)
    drop = {"generated_at"}
    assert {k: v for k, v in committed.items() if k not in drop} == {
        k: v for k, v in fresh.items() if k not in drop
    }


def test_record_all_continues_past_a_failing_pair(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Minor 18: an unknown row (or an HTTP error) skips that pair; the rest are kept."""
    cfg = load_config().model_copy(update={"site_base_url": "https://example.test/data/"})
    out, web = tmp_path / "eval" / "recordings", tmp_path / "web"

    class Two:
        """Two scripted runs back to back (the bad pair never reaches the model)."""

        def __init__(self) -> None:
            self.models = [scripted_model()]

        def converse(self, **kw: Any) -> Any:
            return self.models[0].converse(**kw)

    pairs = [{"target": "nope", "disease": "MS"}, {"target": "cd20", "disease": "MS"}]
    code = record_eval.record_all(
        pairs, cfg=cfg, model=Two(), http=fixture_http(), out_dir=out, web_dir=web
    )
    assert code == 1
    assert (out / "cd20__MS.jsonl").exists() and not (out / "nope__MS.jsonl").exists()
    assert (tmp_path / "eval" / "report.json").exists()
    err = capsys.readouterr().err
    assert "nope/MS: FAILED (ValueError" in err and "1 pair(s) failed" in err


def test_record_eval_bedrock_client_has_timeouts() -> None:
    from diligence.model import bedrock_client_config

    c = bedrock_client_config()
    assert (c.read_timeout, c.connect_timeout) == (60, 5)
    assert c.retries == {"max_attempts": 2, "mode": "standard"}


def test_unretrieved_removal_rate_counts_removed_sentences(tmp_path: Path) -> None:
    lines = read_lines(SYNTHETIC)
    rec = lines[-1]["record"]
    rec["removed"].append(
        {"sentence_id": "s9", "text": "x", "reason": "cites PMID:1, not retrieved in this run"}
    )
    recs = tmp_path / "recs"
    recs.mkdir()
    (recs / "a.jsonl").write_text("".join(json.dumps(x) + "\n" for x in lines))
    report = build_report(recs, tmp_path / "none.csv", previous=None)
    written = len(rec["memo"]["sections"]) + len(rec["removed"])
    assert report["unretrieved_removal_rate"] == pytest.approx(1 / written)
