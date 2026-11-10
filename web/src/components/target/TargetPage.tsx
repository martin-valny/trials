import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { diligenceKey } from "../../lib/diligence";
import { DEFAULT_FIGURE_STATE, figureSearch, markState, normKey, parseFigureState, trialsLink } from "../../lib/pipeline";
import type { PipelineFile, PipelineMark, PipelineRow } from "../../types";
import { usePhone } from "../../lib/useMediaQuery";
import { usePipeline } from "../pipeline/PipelinePage";
import { TrialCard } from "../pipeline/TrialCard";
import "../pipeline/pipeline.css";
import "./target.css";
import { TargetChain } from "./TargetChain";
import { TargetCompanies } from "./TargetCompanies";
import { TargetDiligence } from "./TargetDiligence";
import { TargetDiseases } from "./TargetDiseases";
import { TargetRisk } from "./TargetRisk";
import { TargetStops } from "./TargetStops";
import { TargetTimeline } from "./TargetTimeline";

const n = (x: number): string => x.toLocaleString("en-US");

interface Open {
  nct: string;
  x: number;
  y: number;
  flip: boolean;
}

export function TargetPage() {
  const { slug = "" } = useParams();
  const load = usePipeline();
  const [params] = useSearchParams();
  const file = load.s === "ready" ? load.file : null;
  if (load.s === "loading") return <Skeleton />;
  if (!file) return <Unavailable />;
  const row = file.rows.find((r) => r.id === slug);
  if (!row)
    return (
      <div className="target-page">
        <div className="notfound">
          <h1>{`No target called '${slug}'.`}</h1>
          <p>
            <Link to="/">Back to the pipeline →</Link>
          </p>
        </div>
      </div>
    );
  return <Ready file={file} row={row} disease={parseFigureState(params, file).disease} />;
}

/** "{run} of {n} trials are running, from {k} companies and academic groups. {a} advanced to a later phase; {s} stopped." */
function ledeParts(run: number, total: number, groups: number, adv: number, stop: number) {
  const head = `${n(run)} of ${n(total)} ${total === 1 ? "trial" : "trials"} ${run === 1 ? "is" : "are"} running`;
  const from = groups === 0 ? "." : `, from ${n(groups)} ${groups === 1 ? "company or academic group" : "companies and academic groups"}.`;
  return { head, tail: `${from} `, rest: `${n(adv)} advanced to a later phase; ${n(stop)} stopped.`, adv: `${n(adv)} advanced` };
}

function Ready({ file, row, disease }: { file: PipelineFile; row: PipelineRow; disease: string | null }) {
  const phone = usePhone();
  const [, setParams] = useSearchParams();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const close = useCallback(() => setOpen(null), []);

  // One mark per trial: a row holds a trial once (the pipeline places it by row), but the counts and keys rely on it.
  const marks: PipelineMark[] = useMemo(() => {
    const seen = new Set<string>();
    return row.marks.filter((m) => (disease === null || m.dz.includes(disease)) && !seen.has(m.n) && seen.add(m.n));
  }, [row, disease]);
  const counts = useMemo(() => {
    const dz = new Map<string, number>();
    for (const m of row.marks) for (const d of m.dz) dz.set(d, (dz.get(d) ?? 0) + 1);
    return file.diseases
      .filter((d) => dz.has(d.code) || d.code === disease)
      .map((d) => ({ code: d.code, n: dz.get(d.code) ?? 0 }))
      .sort((a, b) => b.n - a.n);
  }, [file, row, disease]);
  const stats = useMemo(() => {
    const parents = new Set<string>();
    let run = 0;
    let adv = 0;
    let stop = 0;
    for (const m of marks) {
      const s = markState(m, disease);
      if (s === "run") {
        run++;
        const sp = file.sponsors[m.sp];
        if (sp?.kind === "industry") parents.add(normKey(sp.parent));
      }
      if (s === "adv") adv++;
      if (s === "stop") stop++;
    }
    return { run, adv, stop, groups: parents.size };
  }, [file, marks, disease]);

  const family = file.families.find((f) => f.id === row.family)?.label ?? row.family;
  const format = row.sub.split(" · ").filter((p) => p !== row.gene).join(" · ");
  const ncts = [...new Set(marks.map((m) => m.n))];
  const lede = ledeParts(stats.run, ncts.length, stats.groups, stats.adv, stats.stop);
  const back = disease ? `/?${figureSearch({ ...DEFAULT_FIGURE_STATE, disease })}` : "/";

  const onOpen = useCallback((nct: string, el: Element) => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const r = el.getBoundingClientRect();
    const flip = r.bottom + 300 > window.innerHeight;
    setOpen({ nct, flip, x: Math.max(8, Math.min(r.left - box.left, box.width - 346)), y: flip ? r.top - box.top - 8 : r.bottom - box.top + 8 });
  }, []);

  return (
    <div className="target-page" ref={root}>
      <nav className="crumb" aria-label="Breadcrumb">
        <Link to={back}>Pipeline</Link> / {family}
      </nav>
      <header className="thead">
        <div>
          <h1>
            {row.label}
            <small>
              {row.gene ? `gene ${row.gene} · ` : ""}
              {family}
              {format ? ` · ${format}` : ""}
            </small>
          </h1>
          {marks.length === 0 ? (
            <p className="tl">No {row.label} trials{disease ? ` in ${disease}` : ""}.</p>
          ) : (
            <p className="tl">
              <span className="runw">{lede.head}</span>
              {lede.tail}
              <em>{lede.adv}</em>
              {lede.rest.slice(lede.adv.length)}
            </p>
          )}
        </div>
        {marks.length > 0 && (
        <div className="keys" role="group" aria-label="Key numbers">
          <div className="key">
            <b className="k-run">{n(stats.run)}</b>
            <span>still running</span>
          </div>
          <div className="key">
            <b className="k-adv">{n(stats.adv)}</b>
            <span>advanced</span>
          </div>
          <div className="key">
            <b>{n(stats.stop)}</b>
            <span>stopped</span>
          </div>
        </div>
        )}
      </header>
      <div className="dzs" role="group" aria-label="Diseases">
        {counts.map((d) => (
          <button
            key={d.code}
            type="button"
            className={`dz${d.code === disease ? " on" : ""}`}
            aria-pressed={d.code === disease}
            onClick={() => setParams(figureSearch({ ...DEFAULT_FIGURE_STATE, disease: d.code === disease ? null : d.code }), { replace: true })}
          >
            {d.code}
            <b>{n(d.n)}</b>
          </button>
        ))}
      </div>

      {marks.length === 0 ? (
        <p className="sec empty-line">
          No {row.label} trials in {disease}.{" "}
          <Link to={`/target/${row.id}`} replace>
            Show all diseases →
          </Link>
        </p>
      ) : (
        <>
          <section className="sec" aria-labelledby="pa">
            <div className="sec-h">
              <span className="ltr" aria-hidden="true">a</span>
              <h2 id="pa">Every {row.label} trial over time, by drug</h2>
              <p>Line = start to (expected) end · thicker = later phase · dashed = expected, past the data date</p>
            </div>
            <TargetTimeline file={file} label={row.label} marks={marks} disease={disease} onOpen={onOpen} />
          </section>
          <section className="sec two" aria-label="Companies and stops">
            <div role="group" aria-labelledby="pb">
              <div className="sec-h">
                <span className="ltr" aria-hidden="true">b</span>
                <h2 id="pb">Who is working on {row.label}</h2>
                <p>by parent company</p>
              </div>
              <TargetCompanies file={file} marks={marks} disease={disease} onOpen={onOpen} />
            </div>
            <div role="group" aria-labelledby="pc">
              <div className="sec-h">
                <span className="ltr" aria-hidden="true">c</span>
                <h2 id="pc">What stopped, and why</h2>
                <p>{n(stats.stop)} {stats.stop === 1 ? "trial" : "trials"}</p>
              </div>
              <TargetStops file={file} label={row.label} marks={marks} onOpen={onOpen} />
            </div>
          </section>
          <section className="sec" aria-label="How it works">
            <TargetChain file={file} row={row} marks={marks} disease={disease} phone={phone} />
          </section>
        </>
      )}
      <TargetDiseases file={file} row={row} disease={disease} phone={phone} />
      {marks.length > 0 && <TargetRisk rowId={row.id} disease={disease} file={file} label={row.label} marks={marks} />}
      <TargetDiligence
        key={diligenceKey(row.id, disease ?? "all")}
        row={row}
        disease={disease}
        label={row.label}
        diseaseLabel={disease ? (file.diseases.find((d) => d.code === disease)?.label ?? disease) : "All diseases"}
      />

      <footer className="foot">
        <span>ClinicalTrials.gov registered trials only. &lsquo;Advanced&rsquo; means the drug has a later-phase trial; it does not mean it worked.</span>
        {ncts.length > 0 && (
          <Link to={trialsLink(ncts, row.label, disease)}>List {ncts.length === 1 ? "this trial" : `these ${n(ncts.length)} trials`} →</Link>
        )}
      </footer>

      {open && (
        <TrialCard
          nct={open.nct}
          file={file}
          rowId={row.id}
          disease={disease}
          onClose={close}
          variant={phone ? "sheet" : "popover"}
          style={phone ? undefined : { left: open.x, top: open.y, transform: open.flip ? "translateY(-100%)" : undefined }}
        />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="target-page" aria-busy="true" aria-label="Loading the target page">
      <div className="thead">
        <div>
          <div className="sk sk-title" />
          <div className="sk sk-head" />
        </div>
      </div>
      <div className="sec">
        <div className="sk sk-chart" />
      </div>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="target-page">
      <div className="notfound">
        <h1>The pipeline figure isn&rsquo;t available for this data refresh</h1>
        <p>
          The rest of the data is. Browse the list of <Link to="/trials">Trials</Link>.
        </p>
      </div>
    </div>
  );
}
