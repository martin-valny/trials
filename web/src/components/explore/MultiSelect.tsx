import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { filterSummary } from "../../lib/explorer";

const fmt = (n: number): string => n.toLocaleString("en-US");

/** Popovers keep this far (px) from the viewport's right edge. */
const EDGE = 16;
/** Clear space (px) kept between the revealed map and the top of a phone sheet. */
const SHEET_GAP = 8;

/**
 * On a phone the popover is a sheet over the bottom of the viewport. Scroll the page so the element
 * marked ``data-sheet-reveal`` (the map) sits just above the sheet, letting the filter's effect be seen
 * while it is chosen; if the map is taller than the space left, its top is kept in view instead.
 */
function revealAboveSheet(sheet: HTMLElement) {
  const target = document.querySelector<HTMLElement>("[data-sheet-reveal]");
  if (!target) return;
  const room = sheet.getBoundingClientRect().top - SHEET_GAP;
  const box = target.getBoundingClientRect();
  const delta = box.height <= room ? box.bottom - room : box.top;
  if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, behavior: "instant" });
}

/**
 * A toolbar button that opens a popover beneath it. Escape closes it and returns focus to the button;
 * a pointer press anywhere outside, or Tab moving focus out, closes it. The popover is only mounted while open.
 * It opens from the button's left edge, or from its right edge where it would run off the viewport. On a
 * phone it is a bottom sheet headed by ``title`` and a Done button.
 */
export function Dropdown(props: {
  /** The filter's name ("Phase"). */
  label: string;
  /** What it shows now ("all", "2 of 6", "2014–2019"); the button reads "label: value", the value shown only when narrowed. */
  value: string;
  /** True once it hides something: the button goes from quiet (hairline, muted value) to ink. */
  narrowed: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    const pop = popover.current;
    if (!open || !pop) return;
    delete pop.dataset.align;
    if (getComputedStyle(pop).position === "fixed") {
      revealAboveSheet(pop); // the phone sheet spans the viewport already
      return;
    }
    if (pop.getBoundingClientRect().right > document.documentElement.clientWidth - EDGE) pop.dataset.align = "end";
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

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
    close();
  };

  // Tabbing out closes. A null relatedTarget (a click on bare popover padding) is left to the pointer handler.
  const onBlur = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (open && next && !root.current?.contains(next)) setOpen(false);
  };

  return (
    <div
      className={props.className ? `dropdown ${props.className}` : "dropdown"}
      ref={root}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <button
        ref={button}
        type="button"
        className="dropdown-button"
        aria-expanded={open}
        aria-controls={id}
        data-narrowed={props.narrowed}
        onClick={() => setOpen((o) => !o)}
      >
        {/* At rest only the name shows; the value joins it once the filter narrows. Screen readers
            always hear "Name: value". */}
        <span>
          {props.label}
          <span className={props.narrowed ? "dropdown-summary" : "dropdown-summary visually-hidden"}>
            : <span className="dropdown-value">{props.value}</span>
          </span>
        </span>
        <svg className="chevron" width="9" height="6" viewBox="0 0 9 6" aria-hidden="true">
          <path d="M0.5 0.75 4.5 4.75 8.5 0.75" />
        </svg>
      </button>
      {open ? (
        <div className="popover" id={id} ref={popover}>
          <div className="sheet-head">
            <span className="sheet-title">{props.title ?? props.label}</span>
            <button type="button" className="text-button" onClick={close}>
              Done
            </button>
          </div>
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
  /** The unknown ground's swatch: a hairline border so it reads on the plate. */
  none?: boolean;
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
    <Dropdown
      className="multiselect"
      label={label}
      value={filterSummary(selected.size, options.length)}
      narrowed={options.some((o) => !selected.has(o.value))}
    >
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
                className={o.ring ? "swatch ring" : o.none ? "swatch none" : "swatch"}
                style={o.ring ? { borderColor: o.swatch } : { background: o.swatch }}
                aria-hidden="true"
              />
            ) : null}
            <span className="check-label">{o.label}</span>{" "}
            {/* The space keeps the accessible name "Lung cancer 12", not "Lung cancer12". */}
            <span className="check-n">{fmt(o.n)}</span>
          </label>
        ))}
        {visible.length === 0 ? <p className="checklist-empty">No matches</p> : null}
      </div>
    </>
  );
}
