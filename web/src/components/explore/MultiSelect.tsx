import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { filterSummary } from "../../lib/explorer";

const fmt = (n: number): string => n.toLocaleString("en-US");

/**
 * A toolbar button that opens a popover beneath it. Escape closes it and returns focus to the button;
 * a pointer press anywhere outside closes it. The popover is only mounted while open.
 */
export function Dropdown(props: { text: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className={props.className ? `dropdown ${props.className}` : "dropdown"} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="dropdown-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{props.text}</span>
        <svg className="chevron" width="9" height="6" viewBox="0 0 9 6" aria-hidden="true">
          <path d="M0.5 0.75 4.5 4.75 8.5 0.75" />
        </svg>
      </button>
      {open ? (
        <div className="popover" id={id}>
          {props.children}
        </div>
      ) : null}
    </div>
  );
}

export interface MultiSelectOption {
  value: string;
  label: string;
  n: number;
  swatch?: string;
  ring?: boolean;
}

/**
 * A multi-select filter as a dropdown of custom-drawn checkboxes with right-aligned counts. With
 * `searchable`, a filter field narrows the list, and Select all / Select none apply to the visible rows.
 */
export function MultiSelect(props: {
  label: string;
  options: MultiSelectOption[];
  selected: ReadonlySet<string>;
  onChange(next: Set<string>): void;
  searchable?: boolean;
}) {
  const { label, options, selected, onChange } = props;
  return (
    <Dropdown className="multiselect" text={`${label}: ${filterSummary(selected.size, options.length)}`}>
      <MultiSelectBody label={label} options={options} selected={selected} onChange={onChange} searchable={props.searchable} />
    </Dropdown>
  );
}

// Its own component so the search text resets each time the popover opens.
function MultiSelectBody(props: {
  label: string;
  options: MultiSelectOption[];
  selected: ReadonlySet<string>;
  onChange(next: Set<string>): void;
  searchable?: boolean;
}) {
  const { label, options, selected, onChange } = props;
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const setVisible = (on: boolean) => {
    const next = new Set(selected);
    for (const o of visible) {
      if (on) next.add(o.value);
      else next.delete(o.value);
    }
    onChange(next);
  };
  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  return (
    <>
      {props.searchable ? (
        <input
          type="search"
          className="popover-search"
          aria-label={`Filter ${label}`}
          placeholder="Filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      ) : null}
      <div className="popover-actions">
        <button type="button" className="text-button" onClick={() => setVisible(true)}>
          Select all
        </button>
        <button type="button" className="text-button" onClick={() => setVisible(false)}>
          Select none
        </button>
      </div>
      <div role="group" aria-label={label} className="checklist">
        {visible.map((o) => (
          <label key={o.value} className="check">
            <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
            <span className="check-box" aria-hidden="true">
              <svg viewBox="0 0 10 10">
                <path d="M2 5.2 4.1 7.3 8 2.8" />
              </svg>
            </span>
            {o.swatch ? (
              <span
                className={o.ring ? "swatch ring" : "swatch"}
                style={o.ring ? { borderColor: o.swatch } : { background: o.swatch }}
                aria-hidden="true"
              />
            ) : null}
            <span className="check-label">{o.label}</span>
            <span className="check-n">{fmt(o.n)}</span>
          </label>
        ))}
        {visible.length === 0 ? <p className="checklist-empty">No matches</p> : null}
      </div>
    </>
  );
}
