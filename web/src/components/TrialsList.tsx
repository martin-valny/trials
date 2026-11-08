import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadTrials } from "../data";
import { formatDate, formatValue } from "../lib/format";
import type { TrialSummary } from "../types";

type Result = { trials: TrialSummary[] } | { error: string };

/** Browse every tracked trial: search, filter by status, newest change first. */
export function TrialsList() {
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  // A list handed over by another page: ?nct=NCT1,NCT2&from=<what they are>[&disease=…].
  const [params, setParams] = useSearchParams();
  const only = useMemo(() => {
    const v = params.get("nct");
    return v === null ? null : new Set(v.split(",").filter(Boolean));
  }, [params]);
  const from = params.get("from");
  const clearOnly = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("nct");
        next.delete("from");
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

  const all = useMemo(() => (result && "trials" in result ? result.trials : []), [result]);
  const onlyN = useMemo(() => (only === null ? 0 : all.filter((t) => only.has(t.nct_id)).length), [all, only]);
  const statuses = useMemo(() => [...new Set(all.map((t) => t.overall_status))].sort(), [all]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter(
        (t) =>
          (only === null || only.has(t.nct_id)) &&
          (!status || t.overall_status === status) &&
          (!q ||
            [t.nct_id, t.title, t.lead_sponsor ?? ""].some((v) => v.toLowerCase().includes(q))),
      )
      .sort(
        (a, b) =>
          (b.last_change ?? "").localeCompare(a.last_change ?? "") ||
          a.nct_id.localeCompare(b.nct_id),
      );
  }, [all, query, status, only]);

  return (
    <section aria-labelledby="trials-heading">
      <h1 id="trials-heading">Trials</h1>

      {result === null ? <p role="status">Loading trials…</p> : null}
      {result && "error" in result ? (
        <p role="alert">Could not load trials: {result.error}</p>
      ) : null}
      {result && "trials" in result && all.length === 0 ? (
        <p>No trials are tracked yet.</p>
      ) : null}

      {all.length > 0 && only !== null ? (
        <p className="trials-only" role="status">
          Showing {onlyN} {onlyN === 1 ? "trial" : "trials"}{from ? ` from ${from}` : ""} ·{" "}
          <button type="button" className="text-button" onClick={clearOnly}>
            Clear
          </button>
        </p>
      ) : null}

      {all.length > 0 ? (
        <>
          <form className="filters" onSubmit={(e) => e.preventDefault()}>
            <label>
              Search
              <input
                type="search"
                value={query}
                placeholder="NCT number, title or sponsor"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </form>

          {shown.length === 0 ? (
            <p>
              {only !== null && !all.some((t) => only.has(t.nct_id))
                ? "None of these trials are in the current data."
                : "No trials match these filters."}
            </p>
          ) : (
            <table className="changes trials">
              <caption>
                Showing {shown.length} of {all.length} tracked trials
              </caption>
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
                {shown.map((t) => (
                  <tr key={t.nct_id}>
                    <td data-label="Trial">
                      <Link to={`/trial/${t.nct_id}`}>{t.nct_id}</Link>
                      <div className="muted">{t.title}</div>
                      {t.lead_sponsor ? <div className="muted">{t.lead_sponsor}</div> : null}
                    </td>
                    <td data-label="Status">{t.overall_status}</td>
                    <td data-label="Phase">{formatValue("phases", t.phases)}</td>
                    <td data-label="Primary completion">
                      {t.primary_completion_date ? formatDate(t.primary_completion_date) : "—"}
                    </td>
                    <td data-label="Last change">{t.last_change ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </section>
  );
}
