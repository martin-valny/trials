import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadPipeline, loadTrials } from "../data";
import { formatDate, markState, phasesLabel, statusLabel } from "../lib/format";
import { useShowMore } from "../lib/useShowMore";
import type { TrialSummary } from "../types";
import { MultiSelect, type MultiSelectOption } from "./explore/MultiSelect";
import { PageHead } from "./PageHead";
import "./explore/explore.css";
import "./trials.css";

const n = (x: number): string => x.toLocaleString("en-US");

/** A small drawn magnifier, hairline ink, set inside the find pill. */
function FindGlyph() {
  return (
    <svg className="find-glyph" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="5" cy="5" r="3.75" />
      <path d="M7.75 7.75 11 11" />
    </svg>
  );
}

type Result = { trials: TrialSummary[] } | { error: string };

/** Browse every tracked trial: search, filter by status, newest change first. */
export function TrialsList() {
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState("");
  // null = every status (no narrowing); a set = only those.
  const [status, setStatus] = useState<Set<string> | null>(null);
  // A list handed over by another page: ?nct=NCT1,NCT2&from=<what they are>[&disease=…].
  const [params, setParams] = useSearchParams();
  const only = useMemo(() => {
    const v = params.get("nct");
    return v === null ? null : new Set(v.split(",").filter(Boolean));
  }, [params]);
  const from = params.get("from");
  const disease = params.get("disease");
  // Disease labels come from pipeline.json, loaded only when a disease was handed over.
  // undefined = still loading; null = unavailable. Either way an unknown code filters nothing.
  const [diseases, setDiseases] = useState<{ code: string; label: string }[] | null | undefined>(
    undefined,
  );
  const diseaseLabel = disease ? (diseases?.find((d) => d.code === disease)?.label ?? null) : null;
  const clearOnly = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("nct");
        next.delete("from");
        next.delete("disease");
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    let live = true;
    loadTrials()
      .then((file) => live && setResult({ trials: file?.trials ?? [] }))
      .catch(
        (e: unknown) => live && setResult({ error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!disease) return;
    let live = true;
    loadPipeline()
      .then((file) => live && setDiseases(file?.diseases ?? null))
      .catch(() => live && setDiseases(null));
    return () => {
      live = false;
    };
  }, [disease]);
  const diseaseLoading = Boolean(disease) && diseases === undefined;

  const all = useMemo(() => (result && "trials" in result ? result.trials : []), [result]);
  // The handed-over list: ?nct= and (for a known code) ?disease=.
  const scoped = useMemo(
    () =>
      all.filter(
        (t) =>
          (only === null || only.has(t.nct_id)) &&
          (diseaseLabel === null || (t.dz ?? []).includes(disease ?? "")),
      ),
    [all, only, diseaseLabel, disease],
  );
  const onlyN = scoped.length;
  const statusOptions = useMemo<MultiSelectOption[]>(() => {
    const m = new Map<string, number>();
    for (const t of scoped) m.set(t.overall_status, (m.get(t.overall_status) ?? 0) + 1);
    return [...m.entries()]
      .map(([value, count]) => ({ value, label: statusLabel(value), n: count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [scoped]);
  const pickedStatus = status ?? new Set(statusOptions.map((o) => o.value));
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter(
        (t) =>
          (status === null || status.has(t.overall_status)) &&
          (!q ||
            [t.nct_id, t.title, t.lead_sponsor ?? ""].some((v) => v.toLowerCase().includes(q))),
      )
      .sort(
        (a, b) =>
          (b.last_change ?? "").localeCompare(a.last_change ?? "") ||
          a.nct_id.localeCompare(b.nct_id),
      );
  }, [scoped, query, status]);

  // A new query, status pick or handed-over list starts again at the first page.
  const paging = useShowMore(
    JSON.stringify([query.trim().toLowerCase(), status === null ? null : [...status].sort(), params.get("nct"), disease]),
    shown.length,
  );
  const visible = shown.slice(0, paging.visible);

  return (
    <div className="page explore trials-page">
      <PageHead
        title="Trials"
        sentence={all.length > 0 ? `${n(all.length)} tracked trials, most recently changed first.` : undefined}
      />
      <section aria-label="Tracked trials">

      {result === null || diseaseLoading ? <p role="status">Loading trials…</p> : null}
      {result && "error" in result ? (
        <p role="alert">Could not load trials: {result.error}</p>
      ) : null}
      {result && "trials" in result && all.length === 0 ? (
        <p>No trials are tracked yet.</p>
      ) : null}

      {all.length > 0 && !diseaseLoading && (only !== null || diseaseLabel !== null) ? (
        <p className="trials-only tr-only" role="status">
          Showing {onlyN} {onlyN === 1 ? "trial" : "trials"}{from ? ` from ${from}` : ""}{diseaseLabel ? ` in ${diseaseLabel}` : ""} ·{" "}
          <button type="button" className="text-button" onClick={clearOnly}>
            Clear
          </button>
        </p>
      ) : null}

      {all.length > 0 && !diseaseLoading ? (
        <>
          <div className="tr-bar" role="group" aria-label="Trial filters">
            <div className="tb-find">
              <label className="visually-hidden" htmlFor="trials-find">
                Search
              </label>
              <FindGlyph />
              <input
                id="trials-find"
                type="search"
                value={query}
                placeholder="NCT number, title or sponsor"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <MultiSelect
              label="Status"
              options={statusOptions}
              selected={pickedStatus}
              onChange={(next) =>
                setStatus(
                  statusOptions.every((o) => next.has(o.value))
                    ? null
                    : new Set([...next].filter((v) => statusOptions.some((o) => o.value === v))),
                )
              }
            />
          </div>

          {shown.length === 0 ? (
            <p>
              {only !== null && !all.some((t) => only.has(t.nct_id))
                ? "None of these trials are in the current data."
                : "No trials match these filters."}
            </p>
          ) : (
            <>
              <p className="tr-count">
                Showing {n(visible.length)} of {n(shown.length)} {shown.length === 1 ? "trial" : "trials"}
              </p>
              <table className="trials tr-table">
                <caption className="visually-hidden">Tracked trials, most recently changed first</caption>
                <thead>
                  <tr>
                    <th scope="col">Trial</th>
                    <th scope="col">Status</th>
                    <th scope="col">Phase</th>
                    <th scope="col">Primary completion</th>
                    <th scope="col">Last change</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <tr key={t.nct_id}>
                      <td className="tr-trial">
                        <Link to={`/trial/${t.nct_id}`} className="tr-nct">
                          {t.nct_id}
                        </Link>
                        <div className="tr-title">{t.title}</div>
                        {t.lead_sponsor ? <div className="tr-sponsor">{t.lead_sponsor}</div> : null}
                      </td>
                      <td className="tr-status">
                        <i className={`tr-mark ${markState(t.overall_status)}`} aria-hidden="true" />
                        {statusLabel(t.overall_status)}
                      </td>
                      <td className="tr-phase">{phasesLabel(t.phases)}</td>
                      <td className="tr-date">
                        {t.primary_completion_date ? formatDate(t.primary_completion_date) : "—"}
                      </td>
                      <td className="tr-date">
                        {t.last_change ? formatDate({ date: t.last_change, precision: "day", type: null }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {paging.more > 0 ? (
                <button type="button" className="text-button tr-more" onClick={paging.showMore}>
                  Show {n(paging.more)} more, {n(shown.length)} {shown.length === 1 ? "trial" : "trials"}
                </button>
              ) : null}
            </>
          )}
        </>
      ) : null}
      </section>
    </div>
  );
}
