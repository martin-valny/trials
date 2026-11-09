import { useEffect, useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadTrials } from "../../data";
import { aboveLine, countAbove, formatPct, formatRange, rankTrials, vsTypical, type WatchFilter, type WatchRow, type WatchSort } from "../../lib/risk";
import { usePipelineFile } from "../../lib/useDisease";
import { useRisk } from "../../lib/useRisk";
import type { PipelineFile, RiskFile, TrialsIndex } from "../../types";
import { MultiSelect, type MultiSelectOption } from "../explore/MultiSelect";
import { RiskFactors } from "../risk/RiskFactors";
import { RiskNote } from "../risk/RiskNote";
import { RiskAxis, RiskScale } from "../risk/RiskScale";
import "../explore/explore.css";
import "../risk/risk.css";
import "./watchlist.css";

const n = (x: number): string => x.toLocaleString("en-US");
const NONE = "none";
/** Rows shown at first, and added by each "Show N more" (DESIGN.md's show-more pattern). */
const PAGE = 50;

/** trials.json: undefined while loading, null when missing or unreadable (rows then lack title and phase). */
function useTrialsIndex(): TrialsIndex | null | undefined {
  const [f, setF] = useState<TrialsIndex | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadTrials()
      .then((x) => live && setF(x))
      .catch(() => live && setF(null));
    return () => {
      live = false;
    };
  }, []);
  return f;
}

function Head({ lede, claim }: { lede?: string; claim?: string }) {
  return (
    <header className="wl-head">
      <h1>Watchlist</h1>
      {lede ? <p className="wl-lede">{lede}</p> : null}
      {claim ? <p className="wl-claim">{claim}</p> : null}
    </header>
  );
}

/** Route ``/watchlist``: every scored running trial ranked by its estimated chance of stopping early (spec §7). */
export function WatchlistPage() {
  const risk = useRisk();
  const pipeline = usePipelineFile();
  const index = useTrialsIndex();

  if (risk === undefined || pipeline === undefined || index === undefined) {
    return (
      <div className="explore watchlist rk" aria-busy="true">
        <Head />
        <div className="wl-body">
          <div className="skeleton-block wl-sk" aria-hidden="true" />
        </div>
        <p className="visually-hidden" role="status">
          Loading the watchlist…
        </p>
      </div>
    );
  }
  if (risk === null) {
    return (
      <div className="explore watchlist rk">
        <Head />
        <div className="wl-body">
          <p className="wl-msg">Estimates appear after the next daily update.</p>
        </div>
      </div>
    );
  }
  if (!risk.trials) return <TargetList risk={risk} pipeline={pipeline} />;
  return <TrialList risk={risk} trials={risk.trials} pipeline={pipeline} index={index} />;
}

// ---------------------------------------------------------------------------------------------- trials

/** A multi-valued query key: absent is null (no narrowing); present is the chosen values, possibly none. */
function readSet(params: URLSearchParams, key: string): Set<string> | null {
  if (!params.has(key)) return null;
  // Codes and row ids never hold a comma, so "?disease=MS,MG" and repeated keys both read; companies repeat.
  const split = key !== "company";
  return new Set(params.getAll(key).flatMap((v) => (split ? v.split(",") : [v])).filter(Boolean));
}

function tallyBy(rows: WatchRow[], keys: (r: WatchRow) => string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) for (const k of keys(r)) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function TrialList({
  risk,
  trials,
  pipeline,
  index,
}: {
  risk: RiskFile;
  trials: NonNullable<RiskFile["trials"]>;
  pipeline: PipelineFile | null;
  index: TrialsIndex | null;
}) {
  const [params, setParams] = useSearchParams();
  const sort: WatchSort = params.get("sort") === "difference" ? "difference" : "estimate";
  const qs = params.toString();
  const chosen = useMemo(() => {
    const p = new URLSearchParams(qs);
    return { disease: readSet(p, "disease"), company: readSet(p, "company"), target: readSet(p, "target") };
  }, [qs]);

  // Every scored trial, unfiltered: the options and their counts come from here.
  const all = useMemo(() => rankTrials(risk, {}, "estimate", pipeline, index), [risk, pipeline, index]);
  const total = Object.keys(trials).length;

  const labels = useMemo(() => {
    const dz = new Map((pipeline?.diseases ?? []).map((d) => [d.code, d.label]));
    const rows = new Map((pipeline?.rows ?? []).map((r) => [r.id, r.label]));
    return { dz, rows };
  }, [pipeline]);

  const options = useMemo(() => {
    const byDz = tallyBy(all, (r) => r.diseases);
    const byCo = tallyBy(all, (r) => (r.company ? [r.company] : []));
    const byTg = tallyBy(all, (r) => (r.targets.length ? r.targets : [NONE]));
    const disease: MultiSelectOption[] = (pipeline?.diseases ?? [])
      .filter((d) => byDz.has(d.code))
      .map((d) => ({ value: d.code, label: d.label, n: byDz.get(d.code)! }));
    const company: MultiSelectOption[] = [...byCo.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([c, k]) => ({ value: c, label: c, n: k }));
    const target: MultiSelectOption[] = (pipeline?.rows ?? [])
      .filter((r) => byTg.has(r.id))
      .map((r) => ({ value: r.id, label: r.label, n: byTg.get(r.id)! }));
    if (byTg.has(NONE)) target.push({ value: NONE, label: "No target row", n: byTg.get(NONE)! });
    return { disease, company, target };
  }, [all, pipeline]);

  const shown = useMemo(() => {
    const sets = [chosen.disease, chosen.company, chosen.target];
    if (sets.some((s) => s !== null && s.size === 0)) return [];
    const filter: WatchFilter = {
      disease: chosen.disease ? [...chosen.disease] : undefined,
      company: chosen.company ? [...chosen.company] : undefined,
      target: chosen.target ? [...chosen.target] : undefined,
    };
    return rankTrials(risk, filter, sort, pipeline, index);
  }, [risk, pipeline, index, sort, chosen]);

  // The first PAGE rows, more on demand; any change of filters or sort (the query) starts over.
  const [page, setPage] = useState({ qs, limit: PAGE });
  const limit = page.qs === qs ? page.limit : PAGE;
  const visible = shown.slice(0, limit);
  const more = Math.min(PAGE, shown.length - visible.length);

  const update = (f: (p: URLSearchParams) => void) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        f(next);
        return next;
      },
      { replace: true },
    );
  const setFilter = (key: "disease" | "company" | "target", opts: MultiSelectOption[]) => (next: Set<string>) =>
    update((p) => {
      p.delete(key);
      if (opts.every((o) => next.has(o.value))) return;
      const vals = opts.map((o) => o.value).filter((v) => next.has(v));
      if (vals.length === 0) p.set(key, "");
      else if (key === "company") for (const v of vals) p.append(key, v);
      else p.set(key, vals.join(","));
    });
  const setSort = (s: WatchSort) =>
    update((p) => {
      if (s === "difference") p.set("sort", "difference");
      else p.delete("sort");
    });
  const narrowed = chosen.disease !== null || chosen.company !== null || chosen.target !== null;
  const reset = () =>
    update((p) => {
      p.delete("disease");
      p.delete("company");
      p.delete("target");
    });

  const selected = (key: "disease" | "company" | "target", opts: MultiSelectOption[]): Set<string> =>
    chosen[key] ?? new Set(opts.map((o) => o.value));
  // A single chosen disease travels on to the target page.
  const oneDz = chosen.disease?.size === 1 ? [...chosen.disease][0]! : null;
  const bases = [...new Set(all.map((r) => r.basis))];

  return (
    <div className="explore watchlist rk">
      <Head
        lede={`${n(total)} running drug ${total === 1 ? "trial" : "trials"}, ranked by estimated chance of stopping early.`}
        claim={total > 0 ? aboveLine(countAbove(all), total) : undefined}
      />
      <div className="wl-note">
        <RiskNote />
      </div>
      <div className="toolbar wl-toolbar" role="group" aria-label="Watchlist filters">
        <div className="tb-filters">
          <MultiSelect
            label="Disease"
            options={options.disease}
            selected={selected("disease", options.disease)}
            onChange={setFilter("disease", options.disease)}
          />
          <MultiSelect
            label="Company"
            options={options.company}
            selected={selected("company", options.company)}
            onChange={setFilter("company", options.company)}
            searchable={options.company.length > 8}
          />
          <MultiSelect
            label="Target"
            options={options.target}
            selected={selected("target", options.target)}
            onChange={setFilter("target", options.target)}
            searchable={options.target.length > 8}
          />
          <button type="button" className="text-button wl-reset" disabled={!narrowed} onClick={reset}>
            Reset all
          </button>
        </div>
        <div className="tb-sort">
          <span className="tb-k">Sort</span>
          <div className="segmented wl-sort" role="group" aria-label="Sort">
            <button type="button" aria-pressed={sort === "estimate"} onClick={() => setSort("estimate")}>
              Estimate
            </button>
            <button type="button" aria-pressed={sort === "difference"} onClick={() => setSort("difference")}>
              Above typical by most
            </button>
          </div>
        </div>
        <div className="tb-count">
          Showing {n(shown.length)} of {n(total)} {total === 1 ? "trial" : "trials"}
        </div>
      </div>

      <div className="wl-body">
        {total === 0 ? (
          <p className="wl-msg">No running trials have an estimate yet.</p>
        ) : shown.length === 0 ? (
          <p className="wl-msg">No running trials match these filters.</p>
        ) : (
          <>
            <p className="wl-key">
              Ring = estimate, band = range, tick = typical for {bases.length === 1 ? bases[0] : "each trial's phase"}.
            </p>
            <table className="wl-table" aria-label={`Running trials ranked by ${sort === "estimate" ? "estimate" : "difference from typical"}`}>
              <colgroup>
                <col className="wl-c-trial" />
                <col className="wl-c-tgt" />
                <col className="wl-c-est" />
                <col className="wl-c-why" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="wl-trial">Trial</th>
                  <th scope="col" className="wl-tgt">Target · Disease</th>
                  <th scope="col" className="wl-est">
                    <span className="wl-th-t">Estimate vs typical</span>
                    <span className="wl-est-in" aria-hidden="true">
                      <RiskAxis />
                      <span />
                    </span>
                  </th>
                  <th scope="col" className="wl-why">Main factors</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <Row key={r.nct} r={r} rowLabel={labels.rows} dzLabel={labels.dz} disease={oneDz} />
                ))}
              </tbody>
            </table>
            {more > 0 ? (
              <button type="button" className="text-button wl-more" onClick={() => setPage({ qs, limit: limit + PAGE })}>
                Show {n(more)} more, {n(shown.length)} {shown.length === 1 ? "trial" : "trials"}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  r,
  rowLabel,
  dzLabel,
  disease,
}: {
  r: WatchRow;
  rowLabel: Map<string, string>;
  dzLabel: Map<string, string>;
  disease: string | null;
}) {
  const [open, setOpen] = useState(false);
  const whyId = useId();
  const name = r.drug ?? r.title;
  const meta = [r.phase, r.company ?? "Unknown sponsor"].filter(Boolean).join(" · ");
  const q = disease ? `?disease=${encodeURIComponent(disease)}` : "";
  return (
    <tr>
      <td className="wl-trial">
        <div className="rk-nm">
          {name ? (
            <>
              <b>{name}</b> ·{" "}
            </>
          ) : null}
          {meta}
        </div>
        <div className="rk-id">
          <Link to={`/trial/${r.nct}`}>{r.nct}</Link>
          <a href={`https://clinicaltrials.gov/study/${r.nct}`} target="_blank" rel="noopener noreferrer">
            ClinicalTrials.gov ↗
          </a>
        </div>
      </td>
      <td className="wl-tgt">
        <div className="wl-tg">
          {r.targets.length === 0 ? (
            <span className="wl-none">No target row</span>
          ) : (
            r.targets.map((t, i) => (
              <span key={t}>
                {i > 0 ? ", " : null}
                <Link to={`/target/${t}${q}`}>{rowLabel.get(t) ?? t}</Link>
              </span>
            ))
          )}
        </div>
        {r.diseases.length > 0 ? <div className="wl-dz">{r.diseases.map((d) => dzLabel.get(d) ?? d).join(", ")}</div> : null}
      </td>
      <td className="wl-est">
        <div className="wl-est-in">
          <RiskScale p={r.p} lo={r.lo} hi={r.hi} typical={r.typical} />
          <div className="rk-est-t">
            <b>{formatPct(r.p)}</b> ({formatRange(r.lo, r.hi)})
            <small>
              {vsTypical(r.p, r.typical, r.lo, r.hi)} typical {formatPct(r.typical)}
            </small>
          </div>
        </div>
      </td>
      <td className="wl-why" data-label={r.factors.length > 0 ? undefined : "Main factors"}>
        {r.factors.length > 0 ? (
          <>
            {/* A phone shows the factors on demand, as panel e does; wider screens always show them (CSS). */}
            <button type="button" className="rk-more wl-why-btn" aria-expanded={open} aria-controls={whyId} onClick={() => setOpen((v) => !v)}>
              Main factors
            </button>
            <div className="wl-why-in" id={whyId} data-open={open}>
              <RiskFactors factors={r.factors} />
            </div>
          </>
        ) : (
          <span className="wl-none">None listed</span>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------------------------- targets

/** Per-trial estimates switched off: each target's median estimate beside its typical rate. */
function TargetList({ risk, pipeline }: { risk: RiskFile; pipeline: PipelineFile | null }) {
  const rows = useMemo(() => {
    const label = new Map((pipeline?.rows ?? []).map((r) => [r.id, r.label]));
    return Object.entries(risk.targets ?? {})
      .filter(([, t]) => t.all.n > 0)
      .map(([id, t]) => ({ id, label: label.get(id) ?? id, s: t.all }))
      .sort((a, b) => b.s.median - a.s.median || a.label.localeCompare(b.label));
  }, [risk, pipeline]);
  return (
    <div className="explore watchlist rk">
      <Head lede="Running drug trials by target, ranked by median estimated chance of stopping early." />
      <div className="wl-note">
        <RiskNote />
      </div>
      <div className="wl-body">
        {rows.length === 0 ? (
          <p className="wl-msg">No running trials have an estimate yet.</p>
        ) : (
          <table className="wl-table wl-targets" aria-label="Targets by median estimate">
            <thead>
              <tr>
                <th scope="col">Target</th>
                <th scope="col" className="wl-num">Running trials</th>
                <th scope="col" className="wl-num">Median estimate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, label, s }) => (
                <tr key={id}>
                  <td>
                    <Link to={`/target/${id}`}>{label}</Link>
                  </td>
                  <td className="wl-num" data-label="Running trials">
                    {n(s.n)}
                  </td>
                  <td className="wl-num rk-est-t" data-label="Median estimate">
                    <b>{formatPct(s.median)}</b>
                    <small>
                      {vsTypical(s.median, s.typical)} typical {formatPct(s.typical)}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
