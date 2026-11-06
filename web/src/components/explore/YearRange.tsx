import { useState, type CSSProperties } from "react";
import { Dropdown } from "./MultiSelect";

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * A start-year range: two number fields (From, To) above a two-thumb track. Values are clamped to
 * `bounds`, and moving one end past the other drags the other along, so from <= to always holds.
 */
export function YearRange(props: {
  bounds: [number, number];
  value: [number, number];
  onChange(v: [number, number]): void;
}) {
  const [lo, hi] = props.bounds;
  const [from, to] = props.value;
  const all = from <= lo && to >= hi;
  return (
    <Dropdown className="yearrange" title="Start year" label="Years" value={all ? "all" : `${from}–${to}`} narrowed={!all}>
      <YearRangeBody {...props} />
    </Dropdown>
  );
}

function YearRangeBody(props: { bounds: [number, number]; value: [number, number]; onChange(v: [number, number]): void }) {
  const [lo, hi] = props.bounds;
  const [from, to] = props.value;

  const setFrom = (n: number) => {
    const f = clamp(n, lo, hi);
    props.onChange([f, Math.max(to, f)]);
  };
  const setTo = (n: number) => {
    const t = clamp(n, lo, hi);
    props.onChange([Math.min(from, t), t]);
  };

  const span = hi - lo || 1;
  const fill = {
    "--from": (from - lo) / span,
    "--to": (to - lo) / span,
  } as CSSProperties;

  return (
    <div className="years">
      <div className="years-fields">
        <YearField label="From" value={from} lo={lo} hi={hi} commit={setFrom} />
        <span className="years-dash" aria-hidden="true">
          –
        </span>
        <YearField label="To" value={to} lo={lo} hi={hi} commit={setTo} />
      </div>
      <div className="years-track" style={fill}>
        {/* Both thumbs meet at the top end when from = to = hi; From must then be on top or it can't move. */}
        <input
          type="range"
          className={from - lo > span / 2 ? "front" : undefined}
          aria-label="From year"
          min={lo}
          max={hi}
          step={1}
          value={from}
          onChange={(e) => props.onChange([Math.min(Number(e.target.value), to), to])}
        />
        <input
          type="range"
          aria-label="To year"
          min={lo}
          max={hi}
          step={1}
          value={to}
          onChange={(e) => props.onChange([from, Math.max(Number(e.target.value), from)])}
        />
      </div>
      <div className="years-scale" aria-hidden="true">
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </div>
  );
}

/**
 * A year field that lets the user type freely: a partial entry below the lower bound ("2", "20") is
 * held as a draft, and is committed (clamped) once it reaches the bounds, or on blur / Enter.
 */
function YearField(props: { label: string; value: number; lo: number; hi: number; commit(n: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft !== null && draft.trim() !== "" && Number.isFinite(Number(draft))) props.commit(Number(draft));
    setDraft(null);
  };
  return (
    <label className="years-field">
      <span>{props.label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={props.lo}
        max={props.hi}
        step={1}
        value={draft ?? props.value}
        onChange={(e) => {
          const raw = e.target.value;
          const n = Number(raw);
          if (raw.trim() !== "" && Number.isFinite(n) && n >= props.lo) {
            props.commit(n);
            setDraft(null);
          } else {
            setDraft(raw);
          }
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish();
        }}
      />
    </label>
  );
}
