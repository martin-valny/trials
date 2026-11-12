import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { loadIntro, loadMeta } from "../../data";
import { useDiligenceRelease } from "../../lib/diligenceRelease";
import { captionText, VIEW_TEXT, visibleViews, type ViewKey } from "../../lib/intro";
import { useTheme } from "../../lib/theme";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { useTour } from "../../lib/useTour";
import type { IntroFile, Meta } from "../../types";
import { DotCanvas } from "./DotCanvas";
import { IntroKey } from "./IntroKey";
import "./intro.css";

/** The intro's phone layout (spec section 5), not the site-wide 640px. Keep in step with intro.css. */
const PHONE_QUERY = "(max-width: 760px)";
const MISSING = "The overview appears after the next daily update.";
const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
const LETTERS = "abcdefgh";
/** Used until intro.json says which views are worth showing, and when it is missing. */
const FALLBACK: ViewKey[] = ["all", "pipeline", "watchlist", "approaches", "changes", "trials"];

type IntroLoad = { s: "loading" } | { s: "missing" } | { s: "ready"; file: IntroFile };

function useIntro(): IntroLoad {
  const [load, setLoad] = useState<IntroLoad>({ s: "loading" });
  useEffect(() => {
    let live = true;
    loadIntro()
      .then((file) => live && setLoad(file ? { s: "ready", file } : { s: "missing" }))
      .catch(() => live && setLoad({ s: "missing" }));
    return () => { live = false; };
  }, []);
  return load;
}

/** undefined while loading, null when it could not be read. */
function useMeta(): Meta | null | undefined {
  const [meta, setMeta] = useState<Meta | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadMeta().then((m) => live && setMeta(m)).catch(() => live && setMeta(null));
    return () => { live = false; };
  }, []);
  return meta;
}

/** Publishes the shared header's height as --header-h so the intro fills exactly what is left of the viewport. */
function useHeaderHeight(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".site-header");
    const set = () => { if (header && ref.current) ref.current.style.setProperty("--header-h", `${header.offsetHeight}px`); };
    set();
    window.addEventListener("resize", set);
    const ro = typeof ResizeObserver === "function" && header ? new ResizeObserver(set) : null;
    if (header) ro?.observe(header);
    return () => { window.removeEventListener("resize", set); ro?.disconnect(); };
  }, [ref]);
}

export function IntroPage() {
  const root = useRef<HTMLDivElement>(null);
    const phone = useMediaQuery(PHONE_QUERY);
  const { theme } = useTheme();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const meta = useMeta();
  const intro = useIntro();
  const { release, pairs } = useDiligenceRelease();
  const file = intro.s === "ready" ? intro.file : null;
  useHeaderHeight(root);

  const keys = useMemo<ViewKey[]>(() => {
    if (file) return visibleViews(file, pairs);
    return pairs.length > 0 ? [...FALLBACK.slice(0, 2), "diligence", ...FALLBACK.slice(2)] as ViewKey[] : FALLBACK;
  }, [file, pairs]);
  const listed = keys.filter((k) => k !== "all");
  const tour = useTour(keys, reduced);
  const active = keys.includes(tour.active) ? tour.active : "all";
  const letter = (k: ViewKey) => (k === "all" ? "" : LETTERS[listed.indexOf(k)]);
  const text = VIEW_TEXT[active];
  // The count of views and their letters are known only once intro.json and the diligence index have settled;
  // until then the headline and the list reserve their space instead of showing a guess that re-letters.
  const settled = intro.s !== "loading" && release !== "pending";
  const headReady = meta !== undefined;
  const area = meta?.area_label ?? "";
  const count = meta ? meta.trial_count.toLocaleString("en-GB") : "";
  const lead = meta ? `${count} clinical trials in ${area}.` : "Clinical trials.";
  const tail = settled ? `${WORDS[listed.length] ?? listed.length} ways to look at them.` : "";

  /** Phone: the first tap on a pill holds its view; a tap on the held one follows the link. Desktop: the link just opens. */
  const onPill = (e: React.MouseEvent, k: ViewKey) => {
    if (phone && !(tour.held && active === k)) {
      e.preventDefault();
      tour.hold(k);
    }
  };

  return (
    <div className="intro" ref={root}>
      <div className="intro-head">
        <div>
          <h1 className="intro-h1">
            {headReady ? (
              <><b>{lead}</b> {tail}</>
            ) : (
              <span className="intro-hold" aria-hidden="true">0,000 clinical trials in the area. Xxxx ways to look at them.</span>
            )}
          </h1>
        </div>
        <Link className="intro-btn" to="/pipeline">Open the pipeline →</Link>
      </div>
      <div className="intro-body">
        {settled ? (
          <ol className="intro-list" aria-label="The views" onMouseLeave={() => { if (!phone) tour.release(); }}>
            {listed.map((k) => (
              <li key={k}>
                <Link
                  to={VIEW_TEXT[k].to}
                  className={k === active ? "on" : ""}
                  aria-current={k === active ? "true" : undefined}
                  onMouseEnter={() => { if (!phone) tour.hold(k); }}
                  onFocus={() => { if (!phone) tour.hold(k); }}
                  onBlur={() => { if (!phone) tour.release(); }}
                  onClick={(e) => onPill(e, k)}
                >
                  <em>{letter(k)}</em><span className="nm">{VIEW_TEXT[k].name}</span><span className="go" aria-hidden="true">Open →</span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <ol className="intro-list intro-hold" aria-hidden="true">
            {FALLBACK.filter((k) => k !== "all").map((k) => (
              <li key={k}><a><em>&nbsp;</em><span className="nm">&nbsp;</span></a></li>
            ))}
          </ol>
        )}
        <div className="intro-fig">
          <p className="intro-cap">
            <b>{letter(active) ? `${letter(active)} ` : ""}{text.name}.</b> {captionText(active, theme)}
            {active === "all" && <> <Link to="/explore">Explore the map →</Link></>}
            {phone && tour.held && active !== "all" && <> <Link to={text.to}>Open {text.name} →</Link></>}
          </p>
          <div className="intro-canvas">
            {file ? (
              <DotCanvas file={file} pairs={pairs} active={active} reduced={reduced} label={`${text.name}: ${captionText(active, theme)}`} />
            ) : (
              <p className="intro-missing">{intro.s === "missing" ? MISSING : ""}</p>
            )}
          </div>
          <div className="intro-key">
            <IntroKey view={active} file={file} />
            {!phone && !reduced && !tour.held && file && <span className="intro-note">Touring the {(WORDS[listed.length] ?? String(listed.length)).toLowerCase()} views · hover one to hold it</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
