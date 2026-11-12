import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadIntro, loadMeta } from "../../data";
import { useDiligenceRelease } from "../../lib/diligenceRelease";
import { VIEW_TEXT, visibleViews, type ViewKey } from "../../lib/intro";
import { useMediaQuery, usePhone } from "../../lib/useMediaQuery";
import { useTour } from "../../lib/useTour";
import type { IntroFile, Meta } from "../../types";
import { DotCanvas } from "./DotCanvas";
import { IntroKey } from "./IntroKey";
import "./intro.css";

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

function useMeta(): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    let live = true;
    loadMeta().then((m) => live && setMeta(m)).catch(() => undefined);
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
  const nav = useNavigate();
  const phone = usePhone();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const meta = useMeta();
  const intro = useIntro();
  const { pairs } = useDiligenceRelease();
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
  const area = meta?.area_label ?? "";
  const count = meta ? meta.trial_count.toLocaleString("en-GB") : "";

  const tapPill = (k: ViewKey) => {
    if (tour.held && active === k) nav(VIEW_TEXT[k].to);
    else tour.hold(k);
  };

  return (
    <div className="intro" ref={root}>
      <div className="intro-head">
        <div>
          <div className="kicker">{area ? `${area} · rebuilt every morning` : "Rebuilt every morning"}</div>
          <h1 className="intro-h1">
            <b>{meta ? `${count} clinical trials in ${area}.` : "Clinical trials."}</b> {WORDS[listed.length] ?? listed.length} ways to look at them.
          </h1>
        </div>
        <Link className="intro-btn" to="/pipeline">Open the pipeline →</Link>
      </div>
      <div className="intro-body">
        <ol className="intro-list" aria-label="The views" onMouseLeave={() => { if (!phone) tour.release(); }}>
          {listed.map((k) => (
            <li key={k}>
              <button
                type="button"
                className={k === active ? "on" : ""}
                aria-current={k === active ? "true" : undefined}
                onMouseEnter={() => { if (!phone) tour.hold(k); }}
                onFocus={() => { if (!phone) tour.hold(k); }}
                onBlur={() => { if (!phone) tour.release(); }}
                onClick={() => (phone ? tapPill(k) : nav(VIEW_TEXT[k].to))}
              >
                <em>{letter(k)}</em><span className="nm">{VIEW_TEXT[k].name}</span><span className="go">Open →</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="intro-fig">
          <p className="intro-cap">
            <b>{letter(active) ? `${letter(active)} ` : ""}{text.name}.</b> {text.caption}
            {active === "all" && <> <Link to="/explore">Explore the map →</Link></>}
            {phone && tour.held && active !== "all" && <> <Link to={text.to}>Open {text.name} →</Link></>}
          </p>
          <div className="intro-canvas">
            {file ? (
              <DotCanvas file={file} pairs={pairs} active={active} reduced={reduced} label={`${text.name}: ${text.caption}`} />
            ) : (
              <p className="intro-missing">{intro.s === "missing" ? MISSING : ""}</p>
            )}
          </div>
          <div className="intro-key">
            <IntroKey view={active} file={file} />
            {!phone && !reduced && !tour.held && file && <span className="intro-note">Touring the {WORDS[listed.length].toLowerCase()} views · hover one to hold it</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
