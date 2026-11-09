import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadPipeline } from "../../data";
import {
  companyOptions,
  figureSearch,
  hasApprovalData,
  headline,
  marginNotes,
  parseFigureState,
  rowViews,
  sourceLine,
  type FigureState,
  type Headline,
  undatedCount,
} from "../../lib/pipeline";
import { usePhone } from "../../lib/useMediaQuery";
import type { MarkState, PipelineFile, PipelineMark } from "../../types";
import { FigureControls } from "./FigureControls";
import { Mark } from "./Mark";
import { PipelineFigure } from "./PipelineFigure";
import "./pipeline.css";

export type Load = { s: "loading" } | { s: "missing" } | { s: "ready"; file: PipelineFile };

export function usePipeline(): Load {
  const [load, setLoad] = useState<Load>({ s: "loading" });
  useEffect(() => {
    let live = true;
    loadPipeline()
      .then((file) => live && setLoad(file ? { s: "ready", file } : { s: "missing" }))
      .catch(() => live && setLoad({ s: "missing" }));
    return () => {
      live = false;
    };
  }, []);
  return load;
}

const LEGEND: MarkState[] = ["adv", "run", "stop", "fin", "unk"];
const LEGEND_TEXT: Record<MarkState, string> = {
  adv: "Advanced to next phase",
  run: "Still running",
  stop: "Stopped",
  fin: "Finished, no follow-on",
  unk: "Status unknown",
};
const dummy: PipelineMark = { n: "", c: 1, s: "run", y: null, y2: null, dz: [], drug: "", sp: 0 };

export function PipelinePage() {
  const load = usePipeline();
  const [params, setParams] = useSearchParams();
  const phone = usePhone();
  const file = load.s === "ready" ? load.file : null;
  const state = useMemo(() => parseFigureState(params, file), [params, file]);
  const change = (next: FigureState) => setParams(figureSearch(next), { replace: true });

  if (load.s === "loading") return <Skeleton />;
  if (load.s === "missing" || !file) return <Unavailable />;
  return <Ready file={file} state={state} phone={phone} change={change} />;
}

function Ready({ file, state: urlState, phone, change }: { file: PipelineFile; state: FigureState; phone: boolean; change: (s: FigureState) => void }) {
  // By disease has the diseases as columns, so the disease filter does not apply there (it stays in the URL).
  const state = useMemo<FigureState>(() => (urlState.view === "disease" ? { ...urlState, disease: null } : urlState), [urlState]);
  // The year the data was generated for, so "newest" and "started since" do not drift with the clock.
  const year = Number(file.generated_for.slice(0, 4)) || new Date().getFullYear();
  const views = useMemo(() => rowViews(file, state, year), [file, state, year]);
  const head = useMemo(() => headline(file, views, state), [file, views, state]);
  const notes = useMemo(() => marginNotes(views, state, year, file.diseases.map((d) => d.code)), [views, state, year, file.diseases]);
  const source = useMemo(() => {
    const base = sourceLine(file, views);
    const k = state.view === "year" ? undatedCount(views) : 0;
    return k > 0 ? `${base.replace(/\.$/, "")}; ${k} ${k === 1 ? "trial without a start year is" : "trials without a start year are"} not drawn.` : base;
  }, [file, views, state.view]);
  const companies = useMemo(() => companyOptions(file), [file]);
  const empty = views.length === 0 || (state.company !== null && head.kind === "none");
  const disease = file.diseases.find((d) => d.code === state.disease);

  return (
    <div className="pipeline">
      <header className="lede">
        <div>
          <div className="kicker">MS and autoimmune neurology · drug pipeline</div>
          <h1 className="headline">
            <HeadlineText h={head} />
          </h1>
        </div>
        <div className="keys" role="group" aria-label="Key numbers">
          <Key n={head.running} label="trials still running" tone="run" />
          <Key n={head.advanced} label="advanced to a later phase" tone="adv" />
          <Key n={head.companiesRunning} label="companies with a running trial" />
        </div>
      </header>
      <p className="source">
        <Source text={source} />
      </p>
      <FigureControls state={urlState} diseases={file.diseases} companies={companies} onChange={change} />
      <div className="legend" role="group" aria-label="Legend">
        {LEGEND.map((s) => (
          <span key={s}>
            <Mark m={{ ...dummy, s, n: "" }} state={s} />
            {LEGEND_TEXT[s]}
          </span>
        ))}
        {state.view === "disease" && hasApprovalData(file) && (
          <span data-key="approved">
            <i className="floor-swatch" aria-hidden="true" />
            a drug on this target is approved for this disease
          </span>
        )}
        {state.view === "year" ? (
          <span className="legend-note">One mark per trial at its start year{phone ? " (3-year bins)" : ""}</span>
        ) : (
          !phone && (
            <span className="legend-note">
              {state.view === "disease" ? "One mark per trial; a trial in several diseases appears in each" : "One mark per trial, oldest first"} ·{" "}
              <Mark m={{ ...dummy, s: "fin", span: "1/2" }} state="fin" /> spans two phases
            </span>
          )
        )}
      </div>
      {empty ? (
        <p className="plate-empty">
          {state.company !== null ? (
            <>
              {head.text.lead}
              {head.text.rest}{" "}
              <button type="button" onClick={() => change({ ...urlState, company: null })}>
                Clear the company lens →
              </button>
            </>
          ) : (
            <>
              No targeted-drug trials{disease ? ` in ${disease.code}` : ""}.{" "}
              <button type="button" onClick={() => change({ ...urlState, disease: null })}>
                Show all diseases →
              </button>
            </>
          )}
        </p>
      ) : (
        <div className="fig-body" key={`${state.company ?? ""}|${state.view}`}>
          <PipelineFigure file={file} views={views} state={state} notes={notes} phone={phone} onCompany={(c) => change({ ...urlState, company: c })} />
        </div>
      )}
      <footer className="foot">
        <span>&lsquo;Advanced&rsquo; means the drug has a later-phase trial on the registry. It does not mean the drug worked or was approved.</span>
        <span className="foot-links">
          <Link to="/methods">Methods</Link> · <Link to="/approaches/targeted">Mechanism graph</Link>
        </span>
      </footer>
    </div>
  );
}

function HeadlineText({ h }: { h: Headline }) {
  if (h.kind === "field")
    return (
      <>
        <span className="runw">{h.text.lead}</span> {h.text.rest}
      </>
    );
  if (h.kind === "lens") {
    const parts = h.text.rest.split(/(\d[\d,]* running|\d[\d,]* advanced)/);
    return (
      <>
        <b>{h.text.lead}</b>
        {parts.map((p, i) => (/ running$/.test(p) ? <span key={i} className="runw">{p}</span> : / advanced$/.test(p) ? <em key={i}>{p}</em> : p))}
      </>
    );
  }
  return <>{h.text.lead + h.text.rest}</>;
}

const SEE_ALL = "see all in Approaches";
function Source({ text }: { text: string }) {
  const i = text.indexOf(SEE_ALL);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <Link to="/approaches">{SEE_ALL}</Link>
      {text.slice(i + SEE_ALL.length)}
    </>
  );
}

function Key({ n, label, tone }: { n: number; label: string; tone?: "run" | "adv" }) {
  return (
    <div className="key">
      <b className={tone ? `k-${tone}` : undefined}>{n.toLocaleString("en-US")}</b>
      <span>{label}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="pipeline" aria-busy="true" aria-label="Loading the pipeline figure">
      <header className="lede">
        <div>
          <div className="kicker">MS and autoimmune neurology · drug pipeline</div>
          <div className="sk sk-head" />
          <div className="sk sk-head short" />
        </div>
        <div className="keys">
          {[0, 1, 2].map((i) => (
            <div key={i} className="key">
              <div className="sk sk-num" />
              <div className="sk sk-cap" />
            </div>
          ))}
        </div>
      </header>
      <div className="fig">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="sk sk-row" />
        ))}
      </div>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="pipeline">
      <header className="lede unavailable">
        <div>
          <div className="kicker">MS and autoimmune neurology · drug pipeline</div>
          <h1 className="headline">The pipeline figure isn't available for this data refresh</h1>
          <p className="source">
            The rest of the data is. Browse the list of <Link to="/trials">Trials</Link>.
          </p>
        </div>
      </header>
    </div>
  );
}
