# Diligence agent

Bedrock tool-use agent that writes a cited diligence memo for a Trial Radar target/disease row.
Design: `docs/superpowers/specs/2026-11-09-diligence-agent-design.md`.

Local checks (no AWS, no live APIs):

```
cd agent && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src scripts
```

## Evaluation

- `eval/pairs.yaml` lists the target x disease pairs; `scripts/record_eval.py` records them
  against Bedrock (needs real model IDs and prices in `config.yaml`; Martin runs it).
- Recordings (`eval/recordings/*.jsonl`) store model I/O, tool results and the final record.
  CI replays them offline (`tests/test_eval_replay.py`) and fails with "re-record the
  evaluation" when the prompt hash (prompts, tool schemas, model IDs) no longer matches.
- `scripts/eval_report.py` computes `eval/report.json` from recordings; CI gates:
  `citation_validity == 1.0` and `support_rate >= baseline - 0.05`.
- `tests/fixtures/recordings/synthetic.jsonl` is built by code, offline and free. Re-run
  `uv run python scripts/make_synthetic_recording.py` after any prompt, tool-schema or model-ID
  change.
