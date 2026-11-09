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

## Backend and deploy

The backend is one Lambda behind a function URL (`src/diligence/handler.py`), three DynamoDB tables
(runs, limits, flags) and Bedrock. `template.yaml` describes all of it. Martin deploys; CI and
the tests never call AWS (`moto` plus fakes).

Routes: `POST /runs {target, disease, force?}`, `GET /runs/{id}`, `POST /flags`. A run executes in
an asynchronous self-invoke of the same function. Visitor IPs are stored only as
`sha256(IP_SALT + ip)`; CORS is set on the function URL from the `AllowedOrigin` parameter.

Prerequisites:

- AWS CLI and SAM CLI installed, credentials for the target account (outside the repo).
- Bedrock model access enabled in `eu-central-1` for the models named in `config.yaml`
  (`models.writer`, `models.planner`, `models.checker`). Put the real model or EU inference-profile
  IDs, and their prices, into `config.yaml` first; the IDs live only there.

Deploy:

```
cd agent
sam validate --lint
sam build            # runs the Makefile: installs dependencies, copies src/diligence and config.yaml
sam deploy --guided --region eu-central-1
```

`sam deploy --guided` asks for the parameters:

| Parameter | Value |
| --- | --- |
| `AllowedOrigin` | the site origin, e.g. `https://martin-valny.github.io` (no path) |
| `IpSalt` | a long random secret (NoEcho; keep it in a password manager, never commit) |
| `BedrockModelArns` | comma separated foundation-model and inference-profile ARNs covering every model ID in `config.yaml` |
| `SiteBaseUrl` | the site's published JSON base URL with trailing slash |

When the deploy finishes, the `FunctionUrl` output holds the endpoint (also shown by
`sam list stack-outputs`). Build the web app with `VITE_DILIGENCE_URL=<that URL>`.

After the first deploy, create an AWS Budgets alarm for this account (the agent is capped at 30 runs
a day, 3 per visitor, concurrency 2, but a budget alarm is the real backstop).

Tear down everything with `sam delete`.

Run `uv run pytest tests/test_template.py` for the template checks; `sam validate --lint` runs
inside it when the SAM CLI is installed and is skipped otherwise.
