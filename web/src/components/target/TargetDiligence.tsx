import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SECTION_ORDER, flagSentence, formatRunDate, loadRecorded, renderable } from "../../lib/diligence";
import type { Shown } from "../../lib/useDiligenceRun";
import { useDiligence } from "./DiligenceRunContext";
import type { DiligenceJudgement, DiligenceSection, DiligenceSentence, DiligenceStep, DiligenceVerdict, PipelineRow, RunRecord } from "../../types";
import "./diligence.css";

/** Shown verbatim with every judgement, withheld or not (spec §2, anti-goals). */
export const FIXED_LABEL = "AI judgement from public data, not investment advice";

export { formatRunDate };

/** Where "a recorded example" points when this page has no run and no agent. The first evaluation pair (agent/eval/pairs.yaml). */
export const EXAMPLE = { target: "cd20", disease: "all", label: "CD20" };

const SECTION_TITLE: Record<DiligenceSection, string> = {
  landscape: "Landscape",
  track_record: "Track record elsewhere",
  literature: "Literature",
  competition: "Competitive position",
};

const STANCE: Record<DiligenceJudgement["stance"], string> = {
  favours: "Favours further investment in this mechanism for this disease",
  mixed: "Mixed on further investment in this mechanism for this disease",
  against: "Argues against further investment in this mechanism for this disease",
};

const VERDICT_WORDS: Record<DiligenceVerdict["verdict"], string> = {
  supported: "supported",
  partly: "partly supported",
  unsupported: "removed by the checker",
};

const FLAG_MAX = 500;

const n = (x: number): string => x.toLocaleString("en-US");

const seconds = (ms: number): string => (ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);

/** A citable ID's source page; null for an ID in no known format (then it is shown as text, not a link). */
export function citeHref(id: string): { href: string; site: string } | null {
  let m: RegExpMatchArray | null;
  if (/^NCT\d{8}$/.test(id)) return { href: `https://clinicaltrials.gov/study/${id}`, site: "ClinicalTrials.gov" };
  if ((m = id.match(/^PMID:(\d+)$/))) return { href: `https://pubmed.ncbi.nlm.nih.gov/${m[1]}/`, site: "PubMed" };
  if (/^PPR\d+$/.test(id)) return { href: `https://europepmc.org/article/PPR/${id}`, site: "Europe PMC" };
  if (/^CHEMBL\d+$/.test(id)) return { href: `https://www.ebi.ac.uk/chembl/compound_report_card/${id}/`, site: "ChEMBL" };
  if ((m = id.match(/^FDA:([A-Za-z0-9-]+)$/))) return { href: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${m[1]}`, site: "DailyMed" };
  return null;
}


interface Props {
  row: PipelineRow;
  /** The page's disease filter; null = all diseases. */
  disease: string | null;
  label: string;
  diseaseLabel: string;
}

/** Panel g: the diligence agent. Shows a recorded run, or runs the agent live and streams its trace, then the checked memo. */
export function TargetDiligence({ row, disease, label, diseaseLabel }: Props) {
  const dz = disease ?? "all";
  const d = useDiligence();
  const { valid, online, elapsed, lastText, canRun, run } = d;

  const shown = d.phase === "running" ? null : d.shown;
  const trace = d.phase === "running" || (d.attempt && !shown) ? (d.attempt ?? []) : (shown?.rec.steps ?? null);

  let status: string | null = null;
  if (d.phase === "running") status = `Running · ${Math.floor(elapsed / 1000)} s`;
  else if (shown) {
    const date = formatRunDate(shown.rec.finished_at ?? shown.rec.started_at);
    status = shown.fresh ? `New run, ${date}` : `Recorded run, ${date}${shown.stale ? " · data has changed since" : ""}`;
  }

  return (
    <section className="sec dg" aria-labelledby="pg" aria-busy={d.phase === "loading" || undefined}>
      <div className="sec-h">
        <span className="ltr" aria-hidden="true">g</span>
        <h2 id="pg">Diligence (AI agent)</h2>
        <p>
          {label} · {diseaseLabel}
        </p>
      </div>

      {!valid ? (
        <p className="empty-line">No trials on this target in {dz}</p>
      ) : d.phase === "loading" ? (
        <p className="dg-wait">Looking for a recorded run…</p>
      ) : (
        <>
          {(status || canRun) && (
            <div className="dg-bar">
              {status && <p className="dg-status">{status}</p>}
              {canRun && (
                <button type="button" className="dg-run" onClick={() => void run(d.shown !== null)}>
                  {d.shown ? "Run again" : "Run diligence"}
                </button>
              )}
            </div>
          )}
          {d.notice && (
            <p className="dg-notice" role="status">
              {d.notice}
            </p>
          )}
          {!shown && !trace && !d.capped && <Intro online={online} here={row.id === EXAMPLE.target && dz === EXAMPLE.disease} />}
          {trace && (
            <div className={`dg-grid${shown?.rec.memo || d.phase === "running" ? "" : " solo"}`}>
              <Trace steps={trace} running={d.phase === "running"} />
              {d.phase === "running" ? (
                <div className="dg-memo">
                  <h3 className="dg-h">Memo</h3>
                  <p className="dg-pending">The memo appears here once the agent has written it and checked each claim.</p>
                </div>
              ) : shown ? (
                <Memo shown={shown} canFlag={online && shown.source === "backend"} />
              ) : null}
            </div>
          )}
          {!shown?.rec.memo && <p className="dg-label solo">{FIXED_LABEL}</p>}
        </>
      )}
      <p className="visually-hidden" aria-live="polite" data-testid="dg-live">
        {d.phase === "running" ? lastText : ""}
      </p>
    </section>
  );
}

function Intro({ online, here }: { online: boolean; here: boolean }) {
  const ex = `/target/${EXAMPLE.target}${EXAMPLE.disease === "all" ? "" : `?disease=${encodeURIComponent(EXAMPLE.disease)}`}`;
  // The example link is offered only when that example's recording ships with the site (no dead end).
  const [example, setExample] = useState(false);
  useEffect(() => {
    if (online || here) return;
    let on = true;
    void loadRecorded(EXAMPLE.target, EXAMPLE.disease).then((rec) => {
      if (on) setExample(rec !== null);
    });
    return () => {
      on = false;
    };
  }, [online, here]);
  return (
    <div className="dg-intro">
      {online ? (
        <p>
          The agent plans its searches, calls ClinicalTrials.gov, ChEMBL, Europe PMC, openFDA and this site&rsquo;s own data, follows up on what
          it finds, then writes a short memo in which every sentence cites a record it retrieved. A second model checks each claim against
          its source before anything is shown.
        </p>
      ) : (
        <p>
          <b>The diligence agent is offline.</b>{" "}
          {here || !example ? (
            "No run has been recorded for this target yet."
          ) : (
            <>
              No run has been recorded for this target. <Link to={ex}>See a recorded example on {EXAMPLE.label} →</Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Trace({ steps, running }: { steps: DiligenceStep[]; running: boolean }) {
  const tools = steps.filter((x) => x.kind === "tool").length;
  return (
    <div className="dg-tr">
      <h3 className="dg-h">
        Trace
        <span>
          {n(steps.length)} {steps.length === 1 ? "step" : "steps"} · {n(tools)} tool {tools === 1 ? "call" : "calls"}
        </span>
      </h3>
      <ol className="dg-steps" aria-label="Agent trace">
        {steps.map((x) => (
          <li key={x.n} className={`dg-step k-${x.kind}`}>
            <span className="dg-n">{x.n}</span>
            <span className="dg-k">{x.kind}</span>
            <span className="dg-x">
              {x.tool && <b>{x.tool}</b>}
              {x.tool && " "}
              {x.text}
            </span>
            <span className="dg-t">{x.ms > 0 ? seconds(x.ms) : ""}</span>
          </li>
        ))}
      </ol>
      {running && <p className="dg-next">{steps.length === 0 ? "Starting the agent…" : "Waiting for the next step…"}</p>}
    </div>
  );
}

function Memo({ shown, canFlag }: { shown: Shown; canFlag: boolean }) {
  const { rec } = shown;
  const r = renderable(rec);
  const prefix = useId().replace(/:/g, "");
  const anchor = (sid: string) => `${prefix}-${sid}`;
  if (!rec.memo)
    return (
      <div className="dg-memo">
        <h3 className="dg-h">Memo</h3>
        <p className="dg-none">The memo could not be produced. The trace shows how far the agent got.</p>
        <RunDetails rec={rec} />
      </div>
    );
  const memo = rec.memo;
  const byId = new Map(memo.sections.map((x) => [x.id, x]));
  // Buttons, not #fragment links: under HashRouter a bare fragment would be read as a route.
  const go = (sid: string) => {
    const el = document.getElementById(anchor(sid));
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  };

  return (
    <div className="dg-memo">
      <h3 className="dg-h">Memo</h3>
      <p className="dg-ai">
        Written by an AI model from what its tools retrieved in this run, then checked claim by claim against the cited sources by a
        second model. A first draft for a person to verify, not a finished analysis. <Link to="/methods#diligence">How the agent works</Link>
      </p>

      <div className="dg-sum">
        <section className="dg-read" aria-labelledby={`${prefix}-read`}>
          <h4 id={`${prefix}-read`}>Read</h4>
          <ol>
            {memo.read.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </section>

        <section className="dg-j" aria-labelledby={`${prefix}-j`}>
          <h4 id={`${prefix}-j`}>Judgement</h4>
          {r.judgementShown ? (
            <>
              <p className="dg-stance">{STANCE[memo.judgement.stance]}</p>
              <p className="dg-conf">Confidence: {memo.judgement.confidence}</p>
              <p className="dg-because">Because</p>
              <ul className="dg-reasons">
                {memo.judgement.reasons.map((sid) => {
                  const sen = byId.get(sid);
                  return (
                    <li key={sid}>
                      {sen ? (
                        <button type="button" className="dg-to" onClick={() => go(sid)}>
                          {sen.text}
                        </button>
                      ) : (
                        <span className="dg-gone">claim {sid} is not in the memo</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              <p className="dg-stance withheld">Judgement withheld: claims behind it could not be verified</p>
              <ul className="dg-reasons plain">
                {memo.judgement.reasons.map((sid) => {
                  const text = byId.get(sid)?.text ?? rec.removed.find((x) => x.sentence_id === sid)?.text ?? `Claim ${sid}`;
                  const v = r.verdictBySentence.get(sid);
                  return (
                    <li key={sid}>
                      {text}
                      <small>
                        {v ? VERDICT_WORDS[v.verdict] : "not checked"}
                        {v?.reason ? ` — ${v.reason}` : ""}
                      </small>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p className="dg-label">{FIXED_LABEL}</p>
        </section>

        {memo.would_change.length > 0 && (
          <section className="dg-wc" aria-labelledby={`${prefix}-wc`}>
            <h4 id={`${prefix}-wc`}>What would change this view</h4>
            <ul>
              {memo.would_change.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {SECTION_ORDER.map((k) => (
        <section key={k} className="dg-sec" aria-labelledby={`${prefix}-${k}`}>
          <h4 id={`${prefix}-${k}`}>{SECTION_TITLE[k]}</h4>
          {r.sections[k].length === 0 ? (
            <p className="dg-none">No checked claims in this section.</p>
          ) : (
            <ul className="dg-sens">
              {r.sections[k].map((x) => (
                <Sentence key={x.id} s={x} id={anchor(x.id)} v={r.verdictBySentence.get(x.id)} runId={canFlag ? rec.run_id : null} />
              ))}
            </ul>
          )}
        </section>
      ))}

      {r.removed.length > 0 && (
        <section className="dg-removed" aria-labelledby={`${prefix}-rm`}>
          <h4 id={`${prefix}-rm`}>Removed by the checker</h4>
          <ul>
            {r.removed.map((x) => (
              <li key={x.sentence_id}>
                <span className="dg-rm-t">{x.text}</span>
                <small>{x.reason}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RunDetails rec={rec} />
    </div>
  );
}

function Sentence({ s, id, v, runId }: { s: DiligenceSentence; id: string; v: DiligenceVerdict | undefined; runId: string | null }) {
  const textId = `${id}-t`;
  const mark =
    !v || v.verdict === "partly" ? (
      <span className={`dg-mark${v ? "" : " unchecked"}`}>{v ? `partly supported — ${v.reason}` : "not checked"}</span>
    ) : null;
  return (
    <li className={`dg-s${v?.verdict === "partly" ? " partly" : ""}`} id={id} tabIndex={-1}>
      <span className="dg-st" id={textId}>
        {s.text}
      </span>{" "}
      <span className="dg-cites">
        {s.cites.map((c) => {
          const h = citeHref(c);
          return h ? (
            <a key={c} className="dg-cite" href={h.href} target="_blank" rel="noopener noreferrer" aria-label={`${c}, ${h.site}, opens in a new tab`}>
              {c}
            </a>
          ) : (
            <span key={c} className="dg-cite">
              {c}
            </span>
          );
        })}
      </span>
      {runId ? (
        <Flag runId={runId} sentenceId={s.id} describedBy={textId}>
          {mark}
        </Flag>
      ) : (
        mark
      )}
    </li>
  );
}

function Flag({ runId, sentenceId, describedBy, children }: { runId: string; sentenceId: string; describedBy: string; children: ReactNode }) {
  const [st, setSt] = useState<"closed" | "open" | "sending" | "sent" | "error">("closed");
  const [reason, setReason] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const boxId = useId();
  const reopen = useRef(false);

  useEffect(() => {
    if (st === "open" || st === "error") box.current?.focus();
    else if (st === "closed" && reopen.current) {
      reopen.current = false;
      btn.current?.focus();
    }
  }, [st]);

  const cancel = () => {
    reopen.current = true;
    setReason("");
    setSt("closed");
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSt("sending");
    try {
      await flagSentence(runId, sentenceId, reason.trim());
      setSt("sent");
    } catch {
      setSt("error");
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  if (st === "sent")
    return (
      <>
        {children}
        <span className="dg-flagged" role="status">
          Thanks — flagged for review
        </span>
      </>
    );
  if (st === "closed")
    return (
      <>
        <button ref={btn} type="button" className="dg-flag" aria-label="Flag this claim" aria-describedby={describedBy} onClick={() => setSt("open")}>
          Flag
        </button>
        {children}
      </>
    );
  return (
    <>
      {children}
      <form className="dg-form" onSubmit={(e) => void submit(e)} onKeyDown={onKey}>
        <label htmlFor={boxId}>What is wrong with this claim?</label>
        <textarea
          ref={box}
          id={boxId}
          rows={3}
          maxLength={FLAG_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={st === "sending"}
        />
        <div className="dg-form-row">
          <span className="dg-count" aria-hidden="true">
            {reason.length} / {FLAG_MAX}
          </span>
          {st === "error" && (
            <span className="dg-err" role="alert">
              Could not send the flag. Try again.
            </span>
          )}
          <button type="submit" className="dg-send" disabled={st === "sending" || reason.trim() === ""}>
            Send flag
          </button>
          <button type="button" className="dg-cancel" onClick={cancel}>
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}

function RunDetails({ rec }: { rec: RunRecord }) {
  const models = Object.entries(rec.models).map(([k, v]) => `${k} ${String(v)}`);
  const dur = rec.finished_at ? Math.max(0, new Date(rec.finished_at).getTime() - new Date(rec.started_at).getTime()) : null;
  return (
    <dl className="dg-meta" role="group" aria-label="Run details">
      <div>
        <dt>Models</dt>
        <dd>{models.length ? models.join(" · ") : "not recorded"}</dd>
      </div>
      <div>
        <dt>Tokens</dt>
        <dd>
          {n(rec.tokens_in)} in · {n(rec.tokens_out)} out
        </dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>${rec.cost_usd.toFixed(2)} (estimate)</dd>
      </div>
      {dur !== null && dur > 0 && (
        <div>
          <dt>Duration</dt>
          <dd>{seconds(dur)}</dd>
        </div>
      )}
      <div>
        <dt>Data as of</dt>
        <dd>{formatRunDate(rec.data_date)}</dd>
      </div>
      <div>
        <dt>Agent</dt>
        <dd>version {rec.agent_version}</dd>
      </div>
    </dl>
  );
}
