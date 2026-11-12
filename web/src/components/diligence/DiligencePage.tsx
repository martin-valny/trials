// The Diligence page (/diligence, spec section 6.3): what the agent does, the memos recorded with the site, how well it
// does, and in the live state a picker for any target. Methods keeps the full method; this page links to it. While the
// agent is closed (nothing recorded, no backend) the route goes to the Methods diligence section instead.
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { claimCounts, diligenceKey, formatRunDate, loadRecorded, STRIP_STANCE } from "../../lib/diligence";
import { FIXED_LABEL } from "../../lib/diligencePanels";
import { pairHref, useDiligenceRelease, type RecordedPair } from "../../lib/diligenceRelease";
import { usePipelineFile, type PipelineState } from "../../lib/useDisease";
import type { RunRecord } from "../../types";
import { useEvalReport, type EvalReport } from "../DiligenceMethods";
import { PageHead } from "../PageHead";
import { PairPicker } from "./PairPicker";
import "./diligence-page.css";

/** Where Methods describes the agent: its contents strip scrolls to ?s=. */
const METHOD_HREF = "/methods?s=diligence";

export function DiligencePage() {
  const { release, pairs } = useDiligenceRelease();
  if (release === "closed") return <Navigate to={METHOD_HREF} replace />;
  // Until the index is read the page cannot tell open from closed; it shows nothing rather than flash a head.
  if (release === "pending") return <div className="page dp" aria-busy="true" />;
  return <OpenPage pairs={pairs} live={release === "live"} />;
}

function OpenPage({ pairs, live }: { pairs: RecordedPair[]; live: boolean }) {
  const pipeline = usePipelineFile();
  const report = useEvalReport();
  const figures = report ? qualityFigures(report) : [];
  return (
    <div className="page dp">
      <PageHead
        className="dp-head"
        title="AI diligence"
        sentence="An agent drafts a cited memo on a drug target from public sources, then a second model removes every claim its sources do not support."
        aside={<p className="dp-label">{FIXED_LABEL}</p>}
      />
      <div className="dp-body">
        <HowItWorks methodLink={report !== undefined && figures.length === 0} />
        <RecordedMemos pairs={pairs} pipeline={pipeline} />
        {report && figures.length > 0 ? <HowWell report={report} figures={figures} /> : null}
        {live ? (
          <section className="dp-sec" aria-labelledby="dp-any-h">
            <h2 id="dp-any-h">Any target</h2>
            <p className="dp-intro">Pick a target and a disease. Its page shows the latest memo, or lets you run one.</p>
            {pipeline ? (
              <PairPicker pairs={pairs} rows={pipeline.rows} diseases={pipeline.diseases} live />
            ) : pipeline === null ? (
              <p className="dp-intro">The target list is not available at the moment.</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: "Draft with citations",
    text: "The agent searches ClinicalTrials.gov, ChEMBL, Europe PMC and openFDA, then writes a memo in which every sentence cites a record it retrieved.",
  },
  {
    title: "Checker removes unsupported claims",
    text: "A second model reads each sentence against its sources. Unsupported sentences are removed and listed with the reason.",
  },
  {
    title: "Judgement only if its reasons survive",
    text: "The memo's read on the target is shown only when at least two reasons behind it are supported. A failed reason is dropped and lowers the confidence; with fewer than two, the read is withheld.",
  },
] as const;

function HowItWorks({ methodLink }: { methodLink: boolean }) {
  return (
    <section className="dp-sec" aria-labelledby="dp-how-h">
      <h2 id="dp-how-h">How it works</h2>
      <ol className="dp-steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <h3>
              <span className="dp-step-n" aria-hidden="true">
                {i + 1}
              </span>
              {s.title}
            </h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
      {methodLink ? (
        <p className="dp-more">
          <Link to={METHOD_HREF}>Read the full method →</Link>
        </p>
      ) : null}
    </section>
  );
}

interface Memo {
  pair: RecordedPair;
  rec: RunRecord;
}

/** Every recorded memo the index names, in its order; a pair whose memo file is missing is left out. Undefined while loading. */
function useRecordedMemos(pairs: RecordedPair[]): Memo[] | undefined {
  const key = pairs.map((p) => diligenceKey(p.target, p.disease)).join("|");
  const [state, setState] = useState<{ key: string; memos: Memo[] } | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all(pairs.map(async (pair) => ({ pair, rec: await loadRecorded(pair.target, pair.disease) }))).then((all) => {
      if (alive) setState({ key, memos: all.filter((m): m is Memo => m.rec !== null) });
    });
    return () => {
      alive = false;
    };
    // `key` names the pairs; the array itself is a new one on each read of the index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state.memos : undefined;
}

function RecordedMemos({ pairs, pipeline }: { pairs: RecordedPair[]; pipeline: PipelineState }) {
  const memos = useRecordedMemos(pairs);
  const targetLabel = (id: string) => pipeline?.rows.find((r) => r.id === id)?.label ?? id;
  const diseaseLabel = (code: string) =>
    code === "all" ? "All diseases" : (pipeline?.diseases.find((d) => d.code === code)?.label ?? code);
  return (
    <section className="dp-sec" aria-labelledby="dp-memos-h">
      <h2 id="dp-memos-h">Recorded memos</h2>
      <p className="dp-intro">
        AI-written memos recorded with the site, each checked before it was shipped. A memo opens on its target page.
      </p>
      {memos === undefined ? (
        <p className="dp-intro" role="status">
          Reading the recorded memos…
        </p>
      ) : memos.length === 0 ? (
        <p className="dp-intro">No memo has been recorded yet.</p>
      ) : (
        <table className="dp-table" aria-labelledby="dp-memos-h">
          <thead>
            <tr>
              <th scope="col" className="dp-c-t">Target</th>
              <th scope="col" className="dp-c-d">Disease</th>
              <th scope="col" className="dp-c-read">AI read</th>
              <th scope="col" className="dp-c-n">Claims supported</th>
              <th scope="col" className="dp-c-rm">Removed</th>
              <th scope="col" className="dp-c-when">Recorded</th>
              <th scope="col" className="dp-c-go">
                <span className="visually-hidden">Memo</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {memos.map(({ pair, rec }) => {
              const j = rec.judgement_shown && rec.memo ? rec.memo.judgement : null;
              const { n, m } = claimCounts(rec);
              const t = targetLabel(pair.target);
              const d = diseaseLabel(pair.disease);
              return (
                <tr key={diligenceKey(pair.target, pair.disease)}>
                  <td className="dp-t">{t}</td>
                  <td className="dp-d">{d}</td>
                  <td className="dp-read">
                    {j ? (
                      <>
                        <span className="dp-stance">{STRIP_STANCE[j.stance]}</span>
                        <span className="dp-conf">, {j.confidence} confidence</span>
                      </>
                    ) : (
                      <span className="dp-withheld">withheld</span>
                    )}
                  </td>
                  <td className="dp-n">
                    {n} of {m}
                    <span className="dp-ph"> supported</span>
                  </td>
                  <td className="dp-rm">
                    {rec.removed.length}
                    <span className="dp-ph"> removed</span>
                  </td>
                  <td className="dp-when">{formatRunDate(rec.finished_at ?? rec.started_at)}</td>
                  <td className="dp-go">
                    <Link to={pairHref(pair, true)}>
                      Open memo<span className="visually-hidden">: {t} in {d}</span> →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** The headline numbers the evaluation has; a number it does not have is left out. */
function qualityFigures(r: EvalReport): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  if (r.support_rate !== null) out.push({ value: pct(r.support_rate), label: "Support rate" });
  if (r.checker_agreement !== null) out.push({ value: pct(r.checker_agreement), label: "Checker agreement" });
  if (r.judgement_shown_rate !== null) out.push({ value: pct(r.judgement_shown_rate), label: "Runs with a judgement shown" });
  if (r.cost_usd_mean !== null) out.push({ value: `$${r.cost_usd_mean.toFixed(3)}`, label: "Mean cost per run" });
  return out;
}

function HowWell({ report, figures }: { report: EvalReport; figures: { value: string; label: string }[] }) {
  return (
    <section className="dp-sec" aria-labelledby="dp-well-h">
      <h2 id="dp-well-h">How well it does</h2>
      <ul className="dp-figures">
        {figures.map((f) => (
          <li key={f.label}>
            <b>{f.value}</b> <span>{f.label}</span>
          </li>
        ))}
      </ul>
      <p className="dp-more">
        From {report.n_runs} recorded {report.n_runs === 1 ? "run" : "runs"}, evaluated {formatRunDate(report.generated_at)}.{" "}
        <Link to={METHOD_HREF}>How it is measured →</Link>
      </p>
    </section>
  );
}
