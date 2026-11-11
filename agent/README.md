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
  `citation_validity == 1.0` and `support_rate >= baseline - 0.05`. `citation_validity` is
  measured after the checker (1.0 by construction); `unretrieved_removal_rate` is the share of
  written sentences removed for citing or naming an ID the run never retrieved.
- Recordings also store every clock reading (`kind: clock`), so a run that hit its time limit
  replays exactly. Model lines store messages as a delta (`messages_prefix`, `messages_tail`).
- `record_eval.py` records against `site_base_url` (the live site): publish the site data the
  evaluation should see first. A pair that fails is reported and skipped; the exit code is 1.
- First paid step: `uv run python scripts/record_eval.py --pairs eval/pairs.yaml --out
  eval/recordings --only cd20/MS`; read its trace (limit hits, writer length, cache token split,
  removals) before recording every pair. It is also the first real check that Bedrock accepts the
  schema keywords (`pattern`, `minItems`) in `submit_memo`.
- `tests/fixtures/recordings/synthetic.jsonl` is built by code, offline and free. Re-run
  `uv run python scripts/make_synthetic_recording.py` after any prompt, tool-schema or model-ID
  change.

## Backend and deploy

The backend is one Lambda behind a function URL (`src/diligence/handler.py`), three DynamoDB tables
(runs, limits, flags) and Bedrock. `template.yaml` describes all of it. Martin deploys; CI and
the tests never call AWS (`moto` plus fakes).

Routes: `GET /runs/latest?target=&disease=` (the cached or latest run and a `stale` flag, or 404;
read-only, no quota), `POST /runs {target, disease, force?}`, `GET /runs/{id}`, `POST /flags`. A run
executes in an asynchronous self-invoke of the same function. Visitor IPs are stored only as
`sha256(IP_SALT + ip)` (IPv6 by its /64); CORS is set on the function URL from the
`AllowedOrigins` parameter, and the handler rejects any other `Origin`. While `config.yaml` has
placeholder model IDs, `POST /runs` answers 503.

Limits: per run, `config.yaml` `limits` (gathering stops at `max_seconds`; the writer and checker
calls follow, see `loop.py` `WRITER_*_TOKENS` and `checker.py` `CHECKER_MAX_TOKENS`); the Lambda
`Timeout` in `template.yaml` is the hard stop and matches `RUN_TIMEOUT_S` in `store.py`. Failures
are logged to CloudWatch as `{"event": "error", "run_id", "where", "type", "message"}`; pages only
show the exception class.

Prerequisites:

- AWS CLI and SAM CLI installed, credentials for the target account (outside the repo).
- Bedrock model access enabled in `eu-central-1` for the models named in `config.yaml`
  (`models.writer`, `models.planner`, `models.checker`). Put the real model or EU inference-profile
  IDs, and their prices (including the cache read and write prices), into `config.yaml` first; the
  IDs live only there. Every model ID needs a `prices` entry or the config does not load.
- Check Service Quotas, Lambda, "Concurrent executions". New accounts often have 10, and Lambda
  refuses a reservation that leaves fewer than 10 unreserved; deploy with `ReservedConcurrency=0`
  there (the daily caps still bound spend) and raise it once the quota allows.
- The package bundles boto3/botocore from `uv.lock` (`requirements-lambda.txt`), not the Lambda
  runtime's copy, so the Converse `cachePoint` fields validate.

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
| `AllowedOrigins` | comma separated origins, e.g. `https://martin-valny.github.io` (no path); add `http://localhost:4181` for a local check against the deployed backend |
| `IpSalt` | a long random secret (NoEcho; keep it in a password manager, never commit) |
| `BedrockModelArns` | comma separated foundation-model and inference-profile ARNs covering every model ID in `config.yaml` |
| `SiteBaseUrl` | the site's published JSON base URL with trailing slash |
| `ReservedConcurrency` | reserved concurrent executions (default 2; 0 reserves none) |

When the deploy finishes, the `FunctionUrl` output holds the endpoint (also shown by
`sam list stack-outputs`). Set it as the repository variable `DILIGENCE_URL` (Settings, Secrets
and variables, Actions, Variables): the daily Pages build passes it as `VITE_DILIGENCE_URL`; unset,
the site builds the offline panel. For a local build, `VITE_DILIGENCE_URL=<that URL> npm run build`.
`sam build` output (`.aws-sam/`) and the `samconfig.toml` that `sam deploy --guided` writes are
git-ignored.

After the first deploy, create an AWS Budgets alarm for this account (the agent is capped by the
`daily` limits in `config.yaml` and the reserved concurrency, but a budget alarm is the real
backstop).

Smoke test: `curl -i <FunctionUrl>runs/does-not-exist` should answer 404 with a JSON body. A 403
`{"Message":"Forbidden"}` means the public-URL invoke permission is missing.

Tear down everything with `sam delete`.

Run `uv run pytest tests/test_template.py` for the template checks; `sam validate --lint` runs
inside it when the SAM CLI is installed and is skipped otherwise.
