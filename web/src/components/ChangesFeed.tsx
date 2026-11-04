import { useEffect, useMemo, useState } from "react";
import { loadChanges } from "../data";
import { fieldLabel, windowLabel } from "../lib/format";
import type { ChangeItem, Window } from "../types";
import { ChangeRow } from "./ChangeRow";

const WINDOWS: Window[] = [1, 7, 30];

type Result =
  | { win: Window; error: string; items?: undefined }
  | { win: Window; items: ChangeItem[]; error?: undefined };

export function ChangesFeed() {
  const [win, setWin] = useState<Window>(7);
  const [result, setResult] = useState<Result | null>(null);
  const [sponsor, setSponsor] = useState("");
  const [field, setField] = useState("");
  const [notableOnly, setNotableOnly] = useState(true);

  useEffect(() => {
    let live = true;
    loadChanges(win)
      .then((file) => live && setResult({ win, items: file?.changes ?? [] }))
      .catch(
        (e: unknown) =>
          live && setResult({ win, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      live = false;
    };
  }, [win]);

  // A result for another window is stale: treat it as still loading.
  const current = result?.win === win ? result : null;
  const loading = current === null;
  const error = current?.error;
  const ready = current?.items !== undefined;
  const items = useMemo(() => current?.items ?? [], [current]);
  const sponsors = useMemo(
    () => [...new Set(items.map((i) => i.lead_sponsor).filter((s): s is string => !!s))].sort(),
    [items],
  );
  const fields = useMemo(() => [...new Set(items.map((i) => i.field))].sort(), [items]);
  const shown = items.filter(
    (i) =>
      (!notableOnly || i.notable) &&
      (!sponsor || i.lead_sponsor === sponsor) &&
      (!field || i.field === field),
  );

  return (
    <section aria-labelledby="feed-heading">
      <h1 id="feed-heading">Changes</h1>

      <div role="tablist" aria-label="Time window" className="tabs">
        {WINDOWS.map((w) => (
          <button
            key={w}
            role="tab"
            type="button"
            aria-selected={w === win}
            onClick={() => setWin(w)}
          >
            {windowLabel(w)}
          </button>
        ))}
      </div>

      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <label>
          Sponsor
          <select value={sponsor} onChange={(e) => setSponsor(e.target.value)}>
            <option value="">All sponsors</option>
            {sponsors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Field
          <select value={field} onChange={(e) => setField(e.target.value)}>
            <option value="">All fields</option>
            {fields.map((f) => (
              <option key={f} value={f}>
                {fieldLabel(f)}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={notableOnly}
            onChange={(e) => setNotableOnly(e.target.checked)}
          />
          Notable only
        </label>
      </form>

      {loading ? <p role="status">Loading changes…</p> : null}
      {error !== undefined ? <p role="alert">Could not load changes: {error}</p> : null}
      {ready && items.length === 0 ? (
        <p>No changes in the last {windowLabel(win)}</p>
      ) : null}
      {ready && items.length > 0 && shown.length === 0 ? (
        <p>No changes match these filters. Try unchecking “Notable only”.</p>
      ) : null}

      {shown.length > 0 ? (
        <table className="changes">
          <caption>
            Changes detected in the last {windowLabel(win)} ({shown.length} shown)
          </caption>
          <thead>
            <tr>
              <th scope="col">Trial</th>
              <th scope="col">Field</th>
              <th scope="col">Change</th>
              <th scope="col">Why notable</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <ChangeRow key={`${i.nct_id}|${i.field}|${i.detected_date}`} item={i} />
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
