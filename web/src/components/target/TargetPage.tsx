import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { contentsWord } from "../../lib/diligence";
import { isOpen, panelLetters, useDiligenceRelease, type DiligenceRelease } from "../../lib/diligenceRelease";
import { DEFAULT_FIGURE_STATE, diseaseLines, figureSearch, markState, normKey, parseFigureState, targetCompanies, trialsLink } from "../../lib/pipeline";
import { countAbove } from "../../lib/risk";
import type { PipelineFile, PipelineMark, PipelineRow } from "../../types";
import { useRisk } from "../../lib/useRisk";
import { ContentsStrip, scrollToPanel, type ContentsItem } from "../ContentsStrip";
import { useMediaQuery, usePhone } from "../../lib/useMediaQuery";
import { usePipeline } from "../pipeline/PipelinePage";
import { TrialCard } from "../pipeline/TrialCard";
import "../pipeline/pipeline.css";
import "./target.css";
import { TargetChain } from "./TargetChain";
import { TargetCompanies } from "./TargetCompanies";
import { DiligenceRunProvider, useDiligence } from "./DiligenceRunContext";
import { DiligenceStrip } from "./DiligenceStrip";
import { TargetDiligence } from "./TargetDiligence";
import { TargetDiseases } from "./TargetDiseases";
import { TargetRisk, riskRows } from "./TargetRisk";
import { TargetStops } from "./TargetStops";
import { TargetTimeline } from "./TargetTimeline";

const n = (x: number): string => x.toLocaleString("en-US");
/** A panel's heading id from its letter (pa, pb, …). */
const id = (letter: string): string => `p${letter}`;

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
  // The panels' order depends on the release, so nothing is drawn until it is known (no panel jumps once it is).
  const { release } = useDiligenceRelease();
  const file = load.s === "ready" ? load.file : null;
  if (load.s === "loading" || release === "pending") return <Skeleton />;
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
  return <Ready file={file} row={row} disease={parseFigureState(params, file).disease} release={release} />;
}

/** "{run} of {n} trials are running, from {k} companies and academic groups. {a} advanced to a later phase; {s} stopped." */
function ledeParts(run: number, total: number, groups: number, adv: number, stop: number) {
  const head = `${n(run)} of ${n(total)} ${total === 1 ? "trial" : "trials"} ${run === 1 ? "is" : "are"} running`;
  const from = groups === 0 ? "." : `, from ${n(groups)} ${groups === 1 ? "company or academic group" : "companies and academic groups"}.`;
  return { head, tail: `${from} `, rest: `${n(adv)} advanced to a later phase; ${n(stop)} stopped.`, adv: `${n(adv)} advanced` };
}

function Ready({ file, row, disease, release }: { file: PipelineFile; row: PipelineRow; disease: string | null; release: DiligenceRelease }) {
  const phone = usePhone();
  const [params, setParams] = useSearchParams();
  const risk = useRisk();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const close = useCallback(() => setOpen(null), []);
  // Once memos are recorded (or the agent is live) the diligence panel leads as a; while closed it trails as g.
  const first = isOpen(release);
  const L = useMemo(() => panelLetters(first), [first]);

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
  // The contents strip: one item per panel that renders, with the same numbers the panels compute (spec section 4).
  // The diligence panel's item is added by PageContents, first or last as the panel itself is placed.
  const items: ContentsItem[] = useMemo(() => {
    const out: ContentsItem[] = [];
    const add = (letter: string, name: string, count?: string) => out.push({ id: id(letter), letter, name, count });
    if (marks.length > 0) {
      add(L.timeline, "Timeline");
      add(L.companies, "Companies", n(targetCompanies(file, marks).length));
      add(L.stops, "Stops", n(stats.stop));
      add(L.mechanism, "Mechanism");
    }
    const lines = diseaseLines(file, row).length;
    if (lines > 0) add(L.diseases, "Diseases", n(lines));
    if (marks.length > 0 && risk) {
      const scored = riskRows(risk, marks, disease);
      add(L.risk, "Stop chance", scored.length > 0 ? `${n(countAbove(scored.map((r) => r.t)))} above` : undefined);
    }
    return out;
  }, [file, row, marks, stats.stop, risk, disease, L]);
  // The header strip's actions go to the diligence panel with the contents strip's scroller, so the heading clears the sticky strip.
  const goToDiligence = useCallback(() => scrollToPanel(id(L.diligence)), [L.diligence]);
  // At 1100px and up the disease chips sit at the right of the title row; below, on one sideways line under the header.
  // Rendered in one place at a time so the reading and tab order match what is on screen.
  const wide = useMediaQuery("(min-width: 1100px)");
  const chips = (
    <DiseaseChips
      counts={counts}
      disease={disease}
      onPick={(code) => setParams(chipSearch(code === disease ? null : code, params.get("panel")), { replace: true })}
    />
  );
  const back = disease ? `/?${figureSearch({ ...DEFAULT_FIGURE_STATE, disease })}` : "/";

  const onOpen = useCallback((nct: string, el: Element) => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const r = el.getBoundingClientRect();
    const flip = r.bottom + 300 > window.innerHeight;
    setOpen({ nct, flip, x: Math.max(8, Math.min(r.left - box.left, box.width - 346)), y: flip ? r.top - box.top - 8 : r.bottom - box.top + 8 });
  }, []);

  const diligence = (
    <TargetDiligence
      row={row}
      disease={disease}
      label={row.label}
      diseaseLabel={disease ? (file.diseases.find((d) => d.code === disease)?.label ?? disease) : "All diseases"}
      letter={L.diligence}
      release={release}
    />
  );

  return (
    <DiligenceRunProvider row={row} disease={disease}>
      <div className="target-page" ref={root}>
        <nav className="crumb" aria-label="Breadcrumb">
          <Link to={back}>Pipeline</Link> / {family}
        </nav>
        <header className="thead">
          <div className="thead-row">
            <h1>
              {row.label}
              <small>
                {row.gene ? `gene ${row.gene} · ` : ""}
                {family}
                {format ? ` · ${format}` : ""}
              </small>
            </h1>
            {wide && chips}
          </div>
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
          <DiligenceStrip onGo={goToDiligence} release={release} />
        </header>
        {!wide && chips}
        <PageContents items={items} pending={marks.length > 0 && risk === undefined} letter={L.diligence} first={first} release={release} />

        {first && diligence}

        {marks.length === 0 ? (
          <p className="sec empty-line">
            No {row.label} trials in {disease}.{" "}
            <Link to={`/target/${row.id}`} replace>
              Show all diseases →
            </Link>
          </p>
        ) : (
          <>
            <section className="sec" aria-labelledby={id(L.timeline)}>
              <div className="sec-h">
                <span className="ltr" aria-hidden="true">{L.timeline}</span>
                <h2 id={id(L.timeline)} tabIndex={-1}>Every {row.label} trial over time, by drug</h2>
                <p>Line = start to (expected) end · thicker = later phase · dashed = expected, past the data date</p>
              </div>
              <TargetTimeline file={file} label={row.label} marks={marks} disease={disease} onOpen={onOpen} />
            </section>
            <section className="sec two" aria-label="Companies and stops">
              <div role="group" aria-labelledby={id(L.companies)}>
                <div className="sec-h">
                  <span className="ltr" aria-hidden="true">{L.companies}</span>
                  <h2 id={id(L.companies)} tabIndex={-1}>Who is working on {row.label}</h2>
                  <p>by parent company</p>
                </div>
                <TargetCompanies file={file} marks={marks} disease={disease} onOpen={onOpen} />
              </div>
              <div role="group" aria-labelledby={id(L.stops)}>
                <div className="sec-h">
                  <span className="ltr" aria-hidden="true">{L.stops}</span>
                  <h2 id={id(L.stops)} tabIndex={-1}>What stopped, and why</h2>
                  <p>{n(stats.stop)} {stats.stop === 1 ? "trial" : "trials"}</p>
                </div>
                <TargetStops file={file} label={row.label} marks={marks} onOpen={onOpen} />
              </div>
            </section>
            <section className="sec" aria-label="How it works">
              <TargetChain file={file} row={row} marks={marks} disease={disease} phone={phone} letter={L.mechanism} />
            </section>
          </>
        )}
        <TargetDiseases file={file} row={row} disease={disease} phone={phone} letter={L.diseases} />
        {marks.length > 0 && <TargetRisk risk={risk} rowId={row.id} disease={disease} file={file} label={row.label} marks={marks} letter={L.risk} />}
        {!first && diligence}

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
    </DiligenceRunProvider>
  );
}

/** The disease chips: one line; where it overflows it scrolls sideways, and the selected chip is kept in view. */
function DiseaseChips({ counts, disease, onPick }: { counts: { code: string; n: number }[]; disease: string | null; onPick: (code: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const on = el?.querySelector<HTMLElement>(".dz.on");
    if (!el || !on || el.scrollWidth <= el.clientWidth) return;
    const left = on.offsetLeft - el.offsetLeft;
    // Land the chip one gutter in: the scroller's own padding-left is the page gutter at this width.
    const gutter = parseFloat(window.getComputedStyle(el).paddingLeft) || 0;
    if (left < el.scrollLeft || left + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollTo?.({ left: Math.max(0, left - gutter) });
  }, [disease]);
  return (
    <div className="dzs" role="group" aria-label="Diseases" ref={box}>
      {counts.map((d) => (
        <button key={d.code} type="button" className={`dz${d.code === disease ? " on" : ""}`} aria-pressed={d.code === disease} onClick={() => onPick(d.code)}>
          {d.code}
          <b>{n(d.n)}</b>
        </button>
      ))}
    </div>
  );
}

/** A disease chip's search: the figure state for the disease, keeping the contents strip's ?panel=. */
function chipSearch(disease: string | null, panel: string | null): string {
  const q = new URLSearchParams(figureSearch({ ...DEFAULT_FIGURE_STATE, disease }));
  if (panel) q.set("panel", panel);
  return q.toString();
}

/** The contents strip with the diligence panel, whose word comes from the shared diligence run: first when open, last when closed. */
function PageContents({
  items,
  pending,
  letter,
  first,
  release,
}: {
  items: ContentsItem[];
  pending: boolean;
  letter: string;
  first: boolean;
  release: DiligenceRelease;
}) {
  const word = contentsWord(useDiligence(), release);
  const all = useMemo(() => {
    const dg: ContentsItem = { id: id(letter), letter, name: "Diligence", count: word ?? undefined };
    return first ? [dg, ...items] : [...items, dg];
  }, [items, word, letter, first]);
  return <ContentsStrip items={all} label="Panels on this page" pending={pending} />;
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
