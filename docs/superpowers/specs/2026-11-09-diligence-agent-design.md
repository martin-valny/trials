# Diligence agent ("Run diligence") — design

Status: draft for Martin's approval, 2026-11-09. Pieces B and C of the AI roadmap merged into one project (A, the stop-risk model, is `2026-11-09-stop-risk-model-design.md`). Reopens HANDOFF §5.2 ("no AWS, no Bedrock") by Martin's decision on 2026-11-09.

## 1. Intent and why

Trial Radar shows what exists; the stop-risk model adds one quantitative signal. Neither answers the R&D or competitive-intelligence lead's real question about a target in a disease: *is this worth pursuing, and why?* The diligence agent does: from a target page, one click runs a live AI agent that gathers evidence with real tools, follows up on what it finds, and writes a one-page memo ending in an explicit, labelled judgement, with every claim cited and checked.

Martin's framing (2026-11-09): it must be a **visible agent demonstration**, not pre-written articles. The visitor watches the agent plan, call tools, follow a lead and check its own claims. It serves the real reader (a diligence first draft in a minute) and the hiring panel (FDE: agentic workflows, RAG with citations, evaluation in CI, observability, human oversight, secure deployment on enterprise cloud).

## 2. Goals, non-goals, anti-goals

**Goals**
- G1. A "Run diligence" action on each target page for its target and the page's disease filter (fixed request; the agent chooses its own follow-ups).
- G2. A live, step-by-step trace on the page: plan, each tool call with a one-line result, follow-ups, writing, checking.
- G3. A memo: what is being tried and by whom; track record of the target's drugs and class across **all** diseases (registry + approvals); recent literature (Europe PMC abstracts); competitive position incl. stop-risk estimates; a three-line Read (mechanism evidence, competitive position, open questions); an **explicit judgement** (favours / mixed / argues against further investment in this mechanism for this disease) with confidence (high / medium / low) and its reasons; "what would change this view".
- G4. Every factual sentence cites an NCT id, a PMID or a ChEMBL id that the agent actually retrieved in that run; an automated checker verdicts each claim against its cited source and shows the verdict on the page.
- G5. Cost control inside $100 of Bedrock credits: cached runs replayed for free, a daily cap, per-IP limits, per-run step and token caps, an AWS budget alarm.
- G6. An offline evaluation that runs in CI on recorded runs, at $0, and fails on regressions.
- G7. Reader feedback: "flag this claim", stored for Martin to review.

**Non-goals (v1)**
- Free-form questions (v2, once the evaluation is solid).
- Pre-generated, hand-approved memos (rejected: hides the agent).
- Full-text papers; only abstracts.
- Any user accounts, payments or private data.

**Anti-goals**
- A cited ID the agent never retrieved (hallucinated citation) reaching the page.
- A judgement shown when claims behind it failed the checker.
- Wording that reads as investment advice or as a verdict on a company; the label "AI judgement from public data, not investment advice" is always shown.
- A public endpoint that a stranger can use to burn the credits.
- AWS credentials or keys in the repo, the site or the chat.

## 3. Constraints

- The site stays static on GitHub Pages; the agent backend is the only server, on Martin's **personal** AWS account, region `eu-central-1` (Frankfurt), Claude models through Bedrock (EU cross-region inference profile if required for the chosen models).
- Budget: $100 starter credits (check expiry in the console). Always-free services preferred: Lambda (incl. function URLs), DynamoDB, CloudWatch basic, Budgets.
- Tools use only free public APIs plus the site's own published JSON: ClinicalTrials.gov API v2, ChEMBL REST, Europe PMC REST (all checked reachable with `Access-Control-Allow-Origin: *`; no keys).
- Deploys are run by Martin from his machine (an outward-facing action). Infrastructure is code in the repo; no console-only configuration.
- Same honesty principles as the rest of the site: AI-written content labelled; proxies named; never claim unbuilt features.
- Same process rules: never push from the agent session; subagent-driven development; no Workflow tool.

## 4. Approaches considered

1. **Own agent loop on the Bedrock Converse API (tool use), in Python — chosen.** ~200–300 lines: model proposes a tool call, our code runs it, the result goes back, until done or capped. Runs in Lambda; each step written to DynamoDB; the page polls. The same module runs locally and in CI with a recorded-response client. Transparent, testable, cheap; shows understanding of agents rather than configuration.
2. **Strands Agents SDK.** Less code and built-in OpenTelemetry tracing, but a framework in the Lambda and less control over what is recorded and replayed. Not chosen; named in the README as considered.
3. **Bedrock Agents (managed).** Least code, but opaque, console-configured, hard to run offline for CI evaluation, and shows the least engineering. Not chosen; named in the README as considered.

## 5. What Martin decided (2026-11-09)

- Pieces B and C merge; live-first; visible trace; cached runs replayed with a "Recorded run, {date} · Run again" label.
- Fixed request in v1 (target × disease from the target page); free-form is v2.
- The memo ends with an explicit, labelled judgement.
- Track record across all diseases and a literature brief are in scope (his ideas).
- Literature through free APIs, as cheap as possible (Europe PMC chosen over MCP servers or paid tools).
- Oversight is on the page (per-claim checker verdicts, judgement gated on them, reader flags), not a pre-publication approval queue.
- Approach 1.

## 6. The agent

### 6.1 Request and run
- Input: `target` (pipeline row id), `disease` (code or "all"), the site data date (from `meta.json`).
- Cache key: `(target, disease, row_fingerprint, agent_version)` *(Claude's call after the builder check)*. `row_fingerprint` is a hash of the row's trials (NCT, status, phase, stop reason) and their rounded risk estimates for that disease, so a cached run stays valid until that target's data actually changes, not every day. A cached complete run is returned as a replay labelled "Recorded run, {date}"; if a newer fingerprint exists the label adds "data has changed since" and offers "Run again"; "Run again" starts a new run only if the daily cap allows.
- Valid requests *(Claude's call)*: `disease` is "all" or a disease in which the row has at least one trial; other combinations are rejected by the backend and the button is not shown.
- Limits (config, proposals): at most 12 tool calls per run, 60k input tokens and 4k output tokens per run, 90 s wall clock; on any limit the run ends with what it has and says so in the trace.

### 6.2 Tools (each returns compact JSON plus the IDs it retrieved)
- `site_target(target, disease)`: the row's trials (phase, status, company, start/end, stop reason) from the published `pipeline.json` and trial files, and the row's mechanism chain.
- `site_risk(target, disease)`: the row's scored running trials and summary from `risk.json`. If `risk.json` is missing or has no entry, it returns an empty result with a note and the memo says estimates were unavailable *(Claude's call)*. Build order: this project starts after the stop-risk work on `feat/stop-risk` is complete and builds on that branch.
- `registry_search(intervention, condition?, status?)`: ClinicalTrials.gov API v2 search by drug name across all diseases; returns counts by status and phase plus up to 20 trials (NCT, title, condition, phase, status, why_stopped).
- `chembl_drug(name)`: ChEMBL max phase, approved indications, mechanism.
- `literature_search(query, since_year?)`: Europe PMC search; top N (proposal 8) abstracts, trimmed, with PMID, year, journal.
- The agent decides queries and follow-ups (e.g. a stop reason mentioning a safety term triggers a class-safety literature search). The system prompt describes the memo sections, the citation rule and the judgement scale.

### 6.3 Memo format
Structured output (JSON) rendered by the site: sections (landscape, track record elsewhere, literature, competitive position), each a list of sentences with `cites: [ids]`; `read` (three lines); `judgement` {`stance`: favours | mixed | against, `confidence`: high | medium | low, `reasons`: [sentence ids]}; `would_change` (1–3 sentences); metadata (models, tokens, cost estimate, duration, data date, agent version).

### 6.4 Checker
- Deterministic: every sentence has ≥1 citation; every cited ID was returned by a tool in this run (else the sentence is removed and the trace says so); numbers in a sentence must appear in the cited source's text or fields where feasible.
- Model-based: a cheaper model (proposal: Haiku-class) verdicts each sentence against its cited sources: supported / partly / unsupported, with a one-line reason.
- The page shows each sentence's verdict *(Claude's call after the builder check)*: **supported** sentences plain; **partly** sentences shown with a "partly supported" mark and the checker's reason; **unsupported** sentences removed from the memo body and listed under "Removed by the checker" with the reason, so nothing is hidden silently. The judgement renders only if all of its `reasons` are **supported** (a "partly" reason also withholds it); otherwise the page shows "Judgement withheld: claims behind it could not be verified" and lists them.

### 6.5 Models
Claude through Bedrock; model IDs in config. Proposal: a Sonnet-class model writes, a Haiku-class model plans tool calls and checks claims; the evaluation decides whether Haiku alone suffices (cheaper). Prompt caching on the system prompt and tool definitions.

## 7. Backend (AWS)

- **Lambda (Python)** with a **function URL** (no API Gateway): `POST /runs` (start or return cached), `GET /runs/{id}` (trace steps + memo when done), `POST /flags`. The start call invokes the agent asynchronously (same function, async self-invoke or a second function) so the page can poll.
- **DynamoDB** (on-demand, always-free scale): `runs` (cache key, status, steps, memo, metadata), `limits` (per-day global counter, per-IP-hash counters with TTL), `flags` (run id, sentence id, reason, timestamp; no personal data; IPs only as salted hashes for rate limiting).
- **Abuse and cost controls**: CORS limited to the site origin; per-IP limit (proposal 3 new runs per day); global daily cap (proposal 30 new runs); reserved concurrency 2; per-run caps (§6.1); AWS Budget alarm (Martin has one at $10); the page shows "Daily limit reached — showing the latest recorded run" when capped.
- **Observability**: structured JSON logs per step (tool, latency, tokens, cost estimate) to CloudWatch; the trace on the page is the same data.
- **Infrastructure as code**: an AWS SAM template in the repo (`agent/template.yaml`), deployed by Martin with `sam deploy` using his local AWS profile. No credentials in the repo; the function's IAM role allows only `bedrock:InvokeModel` on the configured models, and the three DynamoDB tables.
- **Site config**: the agent endpoint URL is a build-time setting.
- **Recorded runs on the static site** *(Claude's call)*: the evaluation runs (§9) are committed as JSON and published with the site, so those target pages always have a run to show even when the backend is off. With an endpoint, the panel first asks the backend for a cached run (newer), then falls back to the committed one. A page with no run and no endpoint shows "The diligence agent is offline" with a link to a recorded example; with an endpoint, "Run diligence".

## 8. Site (web)

- Target page: a new panel "Diligence (AI agent)" with "Run diligence" (or "Recorded run, {date} · Run again"); the live trace as a vertical step list in the Figure Plate style (no chat bubbles, no spinners-as-decoration); the memo below with citation chips linking to CT.gov / PubMed / ChEMBL, per-sentence checker marks (with text, not colour only), the judgement block with its label, and "Flag" per sentence.
- Methods: a section on the agent (tools, limits, checker, evaluation results from the committed eval report, costs, what is AI-written, the models used).
- Works at 375px, light and dark, keyboard reachable; premium finish review as for every UI change.

## 9. Evaluation

- **Recorded runs**: a script runs the agent for an evaluation set of target × disease pairs (proposal: 15–20 covering crowded, sparse, failed and approved targets) and records every model response and tool result.
- **Replay in CI**: the agent loop runs against the recordings (no network, no cost); tests assert the trace and memo are reproduced and all deterministic checks pass.
- **Metrics** (written to a committed eval report and shown on Methods): citation validity (cited IDs retrieved: must be 100%), claim support rate (checker), checker agreement with a hand-labelled subset (proposal: ~100 sentences labelled by Claude-assisted review with Martin spot-checking — the labelling method is stated), judgement stability across reruns, cost and latency per run.
- **Regression gate** *(Claude's call after the builder check)*: CI never calls a model. It (a) unit-tests the deterministic checker and the loop; (b) replays each recording and asserts the trace and memo are reproduced; (c) checks each recording's stored hash of the system prompt, tool schemas and model IDs against the current code — a mismatch fails CI with "re-record the evaluation", so prompt or tool changes cannot ship unevaluated; (d) fails if the committed eval report shows citation validity < 100% or a support rate more than a fixed margin below the committed baseline. Re-recording is a paid local step run by Martin with his AWS profile (`agent/scripts/record_eval.py`); at a few cents per run, a full re-record of ~20 runs costs well under $2.

## 10. Left to the builder
- Exact prompts, tool JSON schemas, polling interval, DynamoDB key design, retry and backoff, the SAM template details.
- Package layout (proposal: a new top-level `agent/` Python project with its own `pyproject.toml`, separate from `pipeline/`).
- Visual detail inside the Figure Plate system.

## 11. Open for later
- Free-form requests (v2).
- Using the text experiment's eligibility TF-IDF in the risk model if a multi-seed rerun clears the bar.
- A weekly briefing built on the same agent.
