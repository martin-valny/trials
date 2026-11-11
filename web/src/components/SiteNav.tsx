import { useCallback, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { isOpen, useDiligenceRelease } from "../lib/diligenceRelease";
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

/** Pipeline, Watchlist, Approaches, Changes, Trials, Methods; Diligence second once memos are recorded or the agent is
 *  live (not while the index is still being read). A menu button on a phone. */
export function SiteNav() {
  const phone = usePhone();
  const [open, setOpen] = useRouteScopedOpen();
  const diligence = isOpen(useDiligenceRelease().release) ? <NavLink to="/diligence">Diligence</NavLink> : null;

  if (phone)
    return (
      <nav aria-label="Main">
        <button type="button" className="nav-menu-btn" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((o) => !o)}>
          {open ? "✕" : "≡"}
        </button>
        {open && (
          <div className="nav-sheet">
            <NavLink to="/" end>Pipeline</NavLink>
            {diligence}
            <NavLink to="/watchlist">Watchlist</NavLink>
            <NavLink to="/approaches">Approaches</NavLink>
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
      {diligence}
      <NavLink to="/watchlist">Watchlist</NavLink>
      <NavLink to="/approaches">Approaches</NavLink>
      <NavLink to="/changes">Changes</NavLink>
      <NavLink to="/trials">Trials</NavLink>
      <NavLink to="/methods">Methods</NavLink>
    </nav>
  );
}
