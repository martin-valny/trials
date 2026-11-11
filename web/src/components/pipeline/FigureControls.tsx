import { useId, useMemo, useState, type ReactNode } from "react";
import { normKey, type FigureState, type SortKey } from "../../lib/pipeline";
import { usePhone } from "../../lib/useMediaQuery";
import type { PipelineDisease } from "../../types";

const SORTS: [SortKey, string][] = [
  ["run", "most running"],
  ["adv", "most advanced"],
  ["new", "newest activity"],
  ["az", "A–Z"],
];
const SHOWN = 8;

interface Props {
  state: FigureState;
  diseases: PipelineDisease[];
  companies: string[];
  onChange: (next: FigureState) => void;
  /** The legend: from 1100px it shares the controls' second line with the sort, below that it takes its own line. */
  children?: ReactNode;
}

/** Arrangement switch, disease control, company lens and sort (spec §7.1). Every change goes up as a new state. */
export function FigureControls({ state, diseases, companies, onChange, children }: Props) {
  const set = (patch: Partial<FigureState>) => onChange({ ...state, ...patch });
  return (
    <div className="controls">
      <div className="seg" role="group" aria-label="Arrangement">
        {(["phase", "disease", "year"] as const).map((v) => (
          <button key={v} type="button" className={state.view === v ? "on" : ""} aria-pressed={state.view === v} onClick={() => set({ view: v })}>
            {v === "phase" ? "By phase" : v === "disease" ? "By disease" : "By year"}
          </button>
        ))}
      </div>
      {state.view !== "disease" && (
        <div className="seg seg-scroll seg-dz" role="group" aria-label="Disease">
          <button type="button" className={state.disease === null ? "on" : ""} aria-pressed={state.disease === null} onClick={() => set({ disease: null })}>
            All diseases
          </button>
          {diseases.map((d) => (
            <button key={d.code} type="button" className={state.disease === d.code ? "on" : ""} aria-pressed={state.disease === d.code} title={d.label} onClick={() => set({ disease: d.code })}>
              {d.code}
            </button>
          ))}
        </div>
      )}
      {state.company ? (
        <span className="lens-chip">
          {state.company}
          <button type="button" aria-label="Clear company lens" onClick={() => set({ company: null })}>
            ✕
          </button>
        </span>
      ) : (
        <CompanyFind companies={companies} onPick={(company) => set({ company })} />
      )}
      <div className="ctl-break" aria-hidden="true" />
      <label className="sortby">
        Sort{" "}
        <select value={state.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
          {SORTS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {children}
    </div>
  );
}

function CompanyFind({ companies, onPick }: { companies: string[]; onPick: (c: string) => void }) {
  // The full placeholder clips in a phone's pill; the aria-label still names the lens.
  const phone = usePhone();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const hits = useMemo(() => {
    const k = normKey(q);
    return (k ? companies.filter((c) => normKey(c).includes(k)) : companies).slice(0, SHOWN);
  }, [q, companies]);
  const pick = (c: string | undefined) => {
    if (!c) return;
    setQ("");
    setOpen(false);
    onPick(c);
  };
  const showList = open && hits.length > 0;
  return (
    <div className="find">
      <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
        <circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8.6 8.6 12 12" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      <input
        type="text"
        role="combobox"
        aria-label="Company lens"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${id}-${active}` : undefined}
        placeholder={phone ? "Find a company" : "Company lens: find a company"}
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && showList) {
            e.preventDefault();
            pick(hits[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {showList && (
        <ul id={`${id}-list`} role="listbox" className="find-list">
          {hits.map((c, i) => (
            <li
              key={c}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "on" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
