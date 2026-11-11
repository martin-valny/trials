// A target and a disease, then "Open memo →" to that target page at the diligence panel. It only navigates: a run
// starts from the Run button on the target page, never from here. Shared by the Diligence page and the front-door band.
import { useId, useMemo, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { pairHref, type RecordedPair } from "../../lib/diligenceRelease";
import type { PipelineRow } from "../../types";
import "./pair-picker.css";

interface Option {
  value: string;
  label: string;
}

const ALL: Option = { value: "all", label: "All diseases" };

/** Each target the picker offers, in order, with the diseases it can be paired with. */
function choices(
  pairs: RecordedPair[],
  rows: PipelineRow[],
  diseases: { code: string; label: string }[],
  live: boolean,
): { target: Option; diseases: Option[] }[] {
  const dzLabel = (code: string): Option => (code === "all" ? ALL : { value: code, label: diseases.find((d) => d.code === code)?.label ?? code });
  if (live) {
    // Every row; its diseases in the site's disease order, after "All diseases".
    return rows.map((r) => {
      const has = new Set(r.marks.flatMap((m) => m.dz));
      return { target: { value: r.id, label: r.label }, diseases: [ALL, ...diseases.filter((d) => has.has(d.code)).map((d) => dzLabel(d.code))] };
    });
  }
  // Recorded: only the pairs with a memo, targets in the index's order.
  const out = new Map<string, { target: Option; diseases: Option[] }>();
  for (const p of pairs) {
    let c = out.get(p.target);
    if (!c) {
      c = { target: { value: p.target, label: rows.find((r) => r.id === p.target)?.label ?? p.target }, diseases: [] };
      out.set(p.target, c);
    }
    c.diseases.push(dzLabel(p.disease));
  }
  return [...out.values()];
}

export function PairPicker({
  pairs,
  rows,
  diseases,
  live,
}: {
  pairs: RecordedPair[];
  rows: PipelineRow[];
  diseases: { code: string; label: string }[];
  live: boolean;
}): JSX.Element {
  const id = useId();
  const navigate = useNavigate();
  const list = useMemo(() => choices(pairs, rows, diseases, live), [pairs, rows, diseases, live]);
  const [picked, setPicked] = useState<{ target: string | null; disease: string | null }>({ target: null, disease: null });

  // The choice falls back to the first option whenever it is unset or no longer offered (a new target, new data).
  const current = list.find((c) => c.target.value === picked.target) ?? list[0];
  const disease = current?.diseases.find((d) => d.value === picked.disease) ?? current?.diseases[0];

  return (
    <form
      className="pair-picker"
      onSubmit={(e) => {
        e.preventDefault();
        if (current && disease) navigate(pairHref({ target: current.target.value, disease: disease.value }, true));
      }}
    >
      <span className="pp-field">
        <label htmlFor={`${id}-t`}>Target</label>
        <select
          id={`${id}-t`}
          value={current?.target.value ?? ""}
          disabled={!current}
          onChange={(e) => setPicked({ target: e.target.value, disease: null })}
        >
          {list.map((c) => (
            <option key={c.target.value} value={c.target.value}>
              {c.target.label}
            </option>
          ))}
        </select>
      </span>
      <span className="pp-field">
        <label htmlFor={`${id}-d`}>Disease</label>
        <select
          id={`${id}-d`}
          value={disease?.value ?? ""}
          disabled={!disease}
          onChange={(e) => setPicked({ target: current?.target.value ?? null, disease: e.target.value })}
        >
          {(current?.diseases ?? []).map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </span>
      <button type="submit" className="pp-go" disabled={!current || !disease}>
        Open memo →
      </button>
    </form>
  );
}
