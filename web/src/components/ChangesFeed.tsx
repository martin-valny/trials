import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadChanges, loadMeta } from "../data";
import { fieldLabel, windowLabel } from "../lib/format";
import type { ChangeItem, Meta, Window } from "../types";
import { ChangeRow } from "./ChangeRow";
import { MultiSelect, type MultiSelectOption } from "./explore/MultiSelect";
import { PageHead } from "./PageHead";
import "./explore/explore.css";
import "./changes.css";

const WINDOWS: Window[] = [1, 7, 30];

type Result =
  | { win: Window; error: string; items?: undefined }
  | { win: Window; items: ChangeItem[]; error?: undefined };

/** Options for a MultiSelect: one per distinct value, with its count in this window. */
function tally(values: string[], label: (v: string) => string): MultiSelectOption[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .map(([value, n]) => ({ value, label: label(value), n }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The head's one sentence, from the data in view for the chosen window. */
function headSentence(n: number, k: number, win: Window): string {
  const what = n === 1 ? "1 change to a tracked trial" : `${n.toLocaleString("en-US")} changes to tracked trials`;
  return `${what} in the last ${windowLabel(win)}; ${k.toLocaleString("en-US")} notable.`;
}

export function ChangesFeed() {
  const [win, setWin] = useState<Window>(7);
  const [result, setResult] = useState<Result | null>(null);
  // null = every value (no narrowing); a set = only those.
  const [sponsor, setSponsor] = useState<Set<string> | null>(null);
  const [field, setField] = useState<Set<string> | null>(null);
  const [notableOnly, setNotableOnly] = useState(true);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    let live = true;
    loadMeta()
      .then((m) => live && setMeta(m))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

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
  const sponsorOptions = useMemo(
    () => tally(items.map((i) => i.lead_sponsor).filter((s): s is string => !!s), (s) => s),
    [items],
  );
  const fieldOptions = useMemo(
    () => tally(items.map((i) => i.field), fieldLabel),
    [items],
  );
  const picked = (all: MultiSelectOption[], chosen: Set<string> | null): Set<string> =>
    chosen ?? new Set(all.map((o) => o.value));
  /** Everything ticked is no narrowing at all (null), so a window's new options never start hidden. */
  const narrowTo = (all: MultiSelectOption[], next: Set<string>): Set<string> | null =>
    all.every((o) => next.has(o.value)) ? null : new Set([...next].filter((v) => all.some((o) => o.value === v)));
  const shown = items.filter(
    (i) =>
      (!notableOnly || i.notable) &&
      (sponsor === null || (i.lead_sponsor !== null && sponsor.has(i.lead_sponsor))) &&
      (field === null || field.has(i.field)),
  );
  const notableCount = items.filter((i) => i.notable).length;

  return (
    <div className="page explore changes-page">
      <PageHead
        title="Changes"
        sentence={ready && items.length > 0 ? headSentence(items.length, notableCount, win) : undefined}
      />
      <section aria-label="Changes feed">
      <div className="ch-bar" role="group" aria-label="Changes filters">
        <div className="ch-filters">
          <div className="segmented" role="group" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={w === win}
                onClick={() => {
                  setWin(w);
                  // Sponsor and field options depend on the window, so stale picks would hide everything.
                  setSponsor(null);
                  setField(null);
                }}
              >
                {windowLabel(w)}
              </button>
            ))}
          </div>
          <MultiSelect
            label="Sponsor"
            options={sponsorOptions}
            selected={picked(sponsorOptions, sponsor)}
            onChange={(next) => setSponsor(narrowTo(sponsorOptions, next))}
            searchable={sponsorOptions.length > 8}
          />
          <MultiSelect
            label="Field"
            options={fieldOptions}
            selected={picked(fieldOptions, field)}
            onChange={(next) => setField(narrowTo(fieldOptions, next))}
          />
          <button
            type="button"
            className="pill narrowing"
            aria-pressed={notableOnly}
            onClick={() => setNotableOnly((v) => !v)}
          >
            Notable only
          </button>
        </div>
      </div>

      {loading ? <p role="status">Loading changes…</p> : null}
      {error !== undefined ? <p role="alert">Could not load changes: {error}</p> : null}
      {ready && items.length === 0 ? (
        <div className="ch-empty">
          <p>No changes in the last {windowLabel(win)}</p>
          {meta ? (
            <p className="muted">
              Tracking {meta.trial_count} trials
              {meta.tracking_since ? ` since ${meta.tracking_since}` : ""}. A change appears here
              once a tracked field differs between two daily snapshots, so a new deployment starts
              empty. <Link to="/trials">Browse the tracked trials</Link>.
            </p>
          ) : null}
        </div>
      ) : null}
      {ready && items.length > 0 && shown.length === 0 ? (
        <p>No changes match these filters. Turn off “Notable only” to see them all.</p>
      ) : null}

      {shown.length > 0 ? (
        <table className="changes ch-table">
          <caption className="visually-hidden">
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
    </div>
  );
}
