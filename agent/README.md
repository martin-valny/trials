# Diligence agent

Bedrock tool-use agent that writes a cited diligence memo for a Trial Radar target/disease row.
Design: `docs/superpowers/specs/2026-11-09-diligence-agent-design.md`.

Local checks (no AWS, no live APIs):

```
cd agent && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src
```
