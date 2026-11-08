import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { usePhone } from "../lib/useMediaQuery";
import { FreshnessBadge } from "./FreshnessBadge";

export function Brand() {
  return (
    <Link to="/" className="brand">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="9" cy="9" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".55" />
        <circle className="brand-dot" cx="13.2" cy="5.6" r="1.8" />
      </svg>
      Trial Radar
    </Link>
  );
}

/** Open/closed state that resets whenever the route changes (derived, not an effect). */
function useRouteScopedOpen(): [boolean, (f: (o: boolean) => boolean) => void] {
  const { pathname, search } = useLocation();
  const here = pathname + search;
  const [at, setAt] = useState<string | null>(null);
  const open = at === here;
  const set = useCallback((f: (o: boolean) => boolean) => setAt((cur) => (f(cur === here) ? here : null)), [here]);
  return [open, set];
}

const EXPLORE: [string, string][] = [
  ["Trial map", "/explore"],
  ["Mechanism graph", "/approaches/targeted"],
];

/** Pipeline, Approaches, Explore (disclosure), Changes, Trials, Methods. A menu button on a phone. */
export function SiteNav() {
  const phone = usePhone();
  const [open, setOpen] = useRouteScopedOpen();
  const { pathname } = useLocation();

  if (phone)
    return (
      <nav aria-label="Main">
        <button type="button" className="nav-menu-btn" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((o) => !o)}>
          {open ? "✕" : "≡"}
        </button>
        {open && (
          <div className="nav-sheet">
            <NavLink to="/" end>Pipeline</NavLink>
            <NavLink to="/approaches">Approaches</NavLink>
            {EXPLORE.map(([label, to]) => (
              <Link key={to} to={to} className="sub">{label}</Link>
            ))}
            <NavLink to="/changes">Changes</NavLink>
            <NavLink to="/trials">Trials</NavLink>
            <NavLink to="/methods">Methods</NavLink>
            <div className="nav-sheet-fresh">
              <FreshnessBadge />
            </div>
          </div>
        )}
      </nav>
    );
  return (
    <nav aria-label="Main">
      <NavLink to="/" end>Pipeline</NavLink>
      <NavLink to="/approaches">Approaches</NavLink>
      <ExploreMenu active={pathname.startsWith("/explore")} />
      <NavLink to="/changes">Changes</NavLink>
      <NavLink to="/trials">Trials</NavLink>
      <NavLink to="/methods">Methods</NavLink>
    </nav>
  );
}

function ExploreMenu({ active }: { active: boolean }) {
  const [open, setOpen] = useRouteScopedOpen();
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(() => false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, setOpen]);

  const items = () => [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const move = (dir: 1 | -1) => {
    const all = items();
    if (!all.length) return;
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[i < 0 ? (dir === 1 ? 0 : all.length - 1) : (i + dir + all.length) % all.length]!.focus();
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(() => false);
      btn.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(() => true);
        return;
      }
      move(e.key === "ArrowDown" ? 1 : -1);
    }
  };
  return (
    <div
      className={`nav-explore${active ? " on" : ""}`}
      ref={box}
      onKeyDown={key}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(() => false)}
    >
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Explore
      </button>
      {open && (
        <ul role="menu" aria-label="Explore">
          {EXPLORE.map(([label, to]) => (
            <li key={to} role="none">
              <Link to={to} role="menuitem" tabIndex={-1}>{label}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
