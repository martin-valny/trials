// Methods, "How the diligence agent works". Limits and rules are stated as the agent's config and code have them;
// every figure about quality comes from diligence/eval-report.json (written by agent/scripts/record_eval.py) or is absent.
import { useEffect, useState } from "react";
import { longDate } from "./risk/RiskMethods";

/** The shape agent/scripts/eval_report.py writes. */
export interface EvalReport {
  citation_validity: number | null;
  /** Sentences removed before the model check for citing or mentioning an unretrieved identifier, over all written. */
  unretrieved_removal_rate?: number | null;
  support_rate: number | null;
  checker_agreement: number | null;
  judgement_shown_rate: number | null;
  cost_usd_mean: number | null;
  seconds_mean: number | null;
  n_runs: number;
  models: Record<string, string>;
  agent_version: string | null;
  generated_at: string;
}

const pct = (v: number | null): string => (v === null ? "not available" : `${Math.round(v * 100)}%`);

function parseReport(raw: unknown): EvalReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<EvalReport>;
  if (typeof r.n_runs !== "number" || r.n_runs < 1 || typeof r.generated_at !== "string") return null;
  return { ...(r as EvalReport), models: r.models ?? {} };
}

/** diligence/eval-report.json: undefined while loading, null when absent or unreadable. */
export function useEvalReport(): EvalReport | null | undefined {
  const [report, setReport] = useState<EvalReport | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}diligence/eval-report.json`);
        if (!res.ok) throw new Error(String(res.status));
        const parsed = parseReport(await res.json());
        if (live) setReport(parsed);
      } catch {
        if (live) setReport(null);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return report;
}

function Results({ r }: { r: EvalReport }) {
  return (
    <>
      <p>
        {r.n_runs} recorded {r.n_runs === 1 ? "run" : "runs"}, agent version {r.agent_version ?? "unknown"}, evaluated{" "}
        {longDate(r.generated_at)}.
      </p>
      <ul>
        <li>
          Citation validity {pct(r.citation_validity)}: the share of shown citations that point to something the run retrieved
          (sentences that fail this are removed before anything is shown).
        </li>
        {typeof r.unretrieved_removal_rate === "number" ? (
          <li>
            Before the check, {pct(r.unretrieved_removal_rate)} of written sentences cited or named an identifier the run never
            retrieved; they were removed.
          </li>
        ) : null}
        <li>
          Support rate {pct(r.support_rate)}: supported claims divided by all claims checked, including claims later removed.
        </li>
        <li>
          {r.checker_agreement === null ? (
            <>Checker agreement not yet labelled.</>
          ) : (
            <>Checker agreement {pct(r.checker_agreement)}: how often the second model&apos;s verdict matches a label.</>
          )}
          {r.checker_agreement === null ? null : " The comparison uses Claude-assisted labels, and Martin spot-checks a sample."}
        </li>
        <li>Judgement shown in {pct(r.judgement_shown_rate)} of runs.</li>
        {r.cost_usd_mean !== null || r.seconds_mean !== null ? (
          <li>
            Mean per run: {r.cost_usd_mean !== null ? `$${r.cost_usd_mean.toFixed(3)}` : "cost not available"}
            {r.seconds_mean !== null ? `, ${Math.round(r.seconds_mean)} seconds` : ""}.
          </li>
        ) : null}
      </ul>
    </>
  );
}

export function DiligenceMethods() {
  const report = useEvalReport();
  const models = report ? Object.entries(report.models) : [];
  return (
    <section id="diligence" aria-labelledby="diligence-h">
      <h2 id="diligence-h" tabIndex={-1}>How the diligence agent works</h2>
      <p>
        On a target page, the agent writes a first-draft diligence memo for one target in one disease (or across all
        diseases) from public sources. In this version the request is fixed: the same memo structure every time. The memo
        is AI-written; it is a draft for a person to verify, not a finished analysis.
      </p>

      <h3>Tools and sources</h3>
      <p>
        The agent can read the site&apos;s own data, ClinicalTrials.gov, ChEMBL, Europe PMC and openFDA drug labels. Europe
        PMC covers all PubMed abstracts, plus PMC and preprints; the agent reads abstracts only, never full texts. No other
        source is used and none needs a key. Each tool returns what it found together with the identifiers it retrieved, and
        only those identifiers can be cited.
      </p>

      <h3>Limits</h3>
      <p>
        One run may make 12 tool calls, read 150,000 input and 8,000 output tokens (counted cumulatively across the run,
        cached input included) and spend 90 seconds gathering evidence. Hitting a limit ends the gathering with what the run
        has, and the trace says which limit. One model call then writes the memo, with 3,000 to 4,096 output tokens even when
        the caps are spent, plus one repair call if the memo is malformed; the checker&apos;s calls follow, at most 2,000
        output tokens each. The backend stops any run after 4 minutes, and the page waits that long before it says the run
        did not finish. A visitor can start 3 new runs per visitor per day, and 30 per day overall; past that the page shows
        the latest recorded run instead.
      </p>

      <h3>How claims are checked</h3>
      <p>
        First, rules that need no model: every sentence cites, every citation was retrieved in this run, every identifier
        named in a sentence was retrieved in this run, and every number other than a single-digit whole number in a sentence
        (identifiers such as CD20 excluded) appears in the sources it cites. A percentage also matches a fraction in those
        sources, rounded or to one decimal (24% or 24.4% for 0.244). A cited record&apos;s sources include the totals and
        summaries of the search that returned it. A sentence that fails is removed. Then a second model gives each remaining
        sentence a verdict: supported, partly supported or unsupported. Unsupported sentences are removed from the memo and
        listed, with the reason, under &ldquo;Removed by the checker&rdquo;. A judgement is shown only when every reason
        behind it is supported; otherwise the page says it is withheld. The three-line Read and &ldquo;What would change this
        view&rdquo; are summaries, not checked by the second model: an identifier in them that the run did not retrieve is
        replaced by &ldquo;[reference removed]&rdquo;. Text from tools, such as abstracts and registry fields,
        is untrusted data: it is passed to the model as data and the instructions say never to follow it.
      </p>

      <h3>Evaluation</h3>
      <p>
        Recorded runs (every model reply and tool result) are replayed in CI, which needs no model and costs nothing. If the
        prompts, tool definitions or model IDs change, the recordings no longer match and CI fails with &ldquo;re-record the
        evaluation&rdquo;. Recording is done by hand.
      </p>
      {report === undefined ? null : report ? (
        <Results r={report} />
      ) : (
        <p>Evaluation results are published with the first recorded evaluation.</p>
      )}

      <h3>Models and cost</h3>
      <p>
        {models.length ? (
          <>Models used: {models.map(([role, id]) => `${role} ${id}`).join("; ")}.</>
        ) : (
          <>Models: set at deployment.</>
        )}{" "}
        Runs use AWS Bedrock, called from Stockholm (eu-north-1)
        {report && report.cost_usd_mean !== null
          ? ` and cost $${report.cost_usd_mean.toFixed(3)} on average in the evaluation.`
          : "; cost per run is published with the first recorded evaluation."}
      </p>

      <h3>What is AI-written</h3>
      <p>
        The memo, the three-line Read and the judgement are written by the model. The trace and the checker marks are system
        output. On a run served by the agent&apos;s backend, every sentence has a Flag link for readers to report a problem;
        recorded runs shipped with the site have none.
      </p>

      <h3>Approaches considered and not used</h3>
      <ul>
        <li>Strands Agents: a framework running inside the Lambda; it gives less control over recording and replaying a run.</li>
        <li>Bedrock Agents: managed and configured in the console; hard to run offline in CI.</li>
      </ul>
    </section>
  );
}
