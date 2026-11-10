import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useHref, useLocation, useSearchParams } from "react-router-dom";
import { usePhone } from "../lib/useMediaQuery";
import "./contents-strip.css";

export interface ContentsItem {
  /** The id of the heading the item scrolls to and focuses (tabIndex -1). */
  id: string;
  letter?: string;
  name: string;
  /** The panel's one computed number or word, muted; left out at phone width. */
  count?: string;
}

interface Props {
  items: ContentsItem[];
  label: string;
  /** The query parameter that names the panel; "panel" by default. */
  param?: string;
  /** True while a panel that may yet render is still loading: a deep link to it is kept until it settles. */
  pending?: boolean;
}

const key = (i: ContentsItem): string => i.letter ?? i.id;

/** Scroll a heading to the top (clear of the sticky strip, by its scroll-margin) and move focus to it.
 *  Smooth only when the visitor has not asked for less motion. The page's one scroller for panels. */
export function scrollToPanel(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const smooth = window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches === true;
  el.scrollIntoView?.({ block: "start", behavior: smooth ? "smooth" : "auto" });
  el.focus({ preventScroll: true });
}

/** Height of the strip, written to --strip-h on the root so headings (scroll-margin-top) and other sticky parts clear it. */
function useStripHeight(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement.style;
    const write = () => root.setProperty("--strip-h", `${el.offsetHeight}px`);
    write();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(write) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.removeProperty("--strip-h");
    };
  }, [ref]);
}

/** The panel nearest the top: the last heading above a reading line just under the strip. At the foot of the page,
 *  where the last panels cannot reach the top, the last heading in view; a clicked panel stays current while in view. */
function useCurrent(items: ContentsItem[], strip: RefObject<HTMLElement | null>, clicked: RefObject<string | null>) {
  const [current, setCurrent] = useState<string | null>(null);
  const ids = items.map((i) => i.id).join(" ");
  useEffect(() => {
    const els = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => e !== null);
    if (els.length === 0 || typeof IntersectionObserver !== "function") return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = strip.current?.getBoundingClientRect().bottom ?? 0;
      const vh = window.innerHeight;
      const line = top + Math.max(24, (vh - top) * 0.25);
      const atFoot = window.scrollY + vh >= document.documentElement.scrollHeight - 2;
      const tops = els.map((e) => e.getBoundingClientRect().top);
      const lock = clicked.current;
      const lockAt = lock ? els.findIndex((e) => e.id === lock) : -1;
      if (lockAt >= 0 && tops[lockAt]! >= 0 && tops[lockAt]! < vh) return setCurrent(lock);
      clicked.current = null;
      let at = -1;
      tops.forEach((t, i) => {
        if (t <= line || (atFoot && t < vh)) at = i;
      });
      setCurrent(at >= 0 ? els[at]!.id : null);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // Headings crossing the strip or the viewport's edges, plus scrolling at the foot of the page, where nothing crosses.
    const io = new IntersectionObserver(schedule, { threshold: [0, 1] });
    for (const e of els) io.observe(e);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids, strip, clicked]);
  return current;
}

/** One sticky line of links to the panels on the page; the current one underlined. ?panel= deep-links to a panel. */
export function ContentsStrip({ items, label, param = "panel", pending = false }: Props) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const phone = usePhone();
  const nav = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const clicked = useRef<string | null>(null);
  // The deep link is read once, on the first render; it scrolls once, when its panel has rendered.
  const wanted = useRef<string | null>(params.get(param));
  useStripHeight(nav);
  const current = useCurrent(items, nav, clicked);

  const value = params.get(param);
  const settle = useCallback(() => {
    const want = wanted.current;
    if (want === null) return;
    const item = items.find((i) => key(i) === want);
    if (item && document.getElementById(item.id)) {
      wanted.current = null;
      clicked.current = item.id;
      scrollToPanel(item.id);
    } else if (!pending) wanted.current = null;
  }, [items, pending]);
  useEffect(settle, [settle]);

  // A ?panel= naming a panel that does not render (now, or after a disease change) is dropped.
  useEffect(() => {
    if (value === null || pending || items.some((i) => key(i) === value)) return;
    setParams(
      (p) => {
        p.delete(param);
        return p;
      },
      { replace: true },
    );
  }, [value, pending, items, param, setParams]);

  // At phone width the line scrolls sideways: keep the current item in view, scrolling the strip only.
  useEffect(() => {
    const ul = list.current;
    const a = current ? ul?.querySelector<HTMLElement>(`[data-for="${current}"]`) : null;
    if (!ul || !a || ul.scrollWidth <= ul.clientWidth) return;
    const left = a.offsetLeft - ul.offsetLeft;
    if (left < ul.scrollLeft || left + a.offsetWidth > ul.scrollLeft + ul.clientWidth) {
      ul.scrollTo?.({ left: Math.max(0, left - 16) });
    }
  }, [current]);

  const go = (e: MouseEvent, item: ContentsItem) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    wanted.current = null;
    clicked.current = item.id;
    scrollToPanel(item.id);
    setParams(
      (p) => {
        p.set(param, key(item));
        return p;
      },
      { replace: true },
    );
  };

  return (
    <nav className="contents-strip" aria-label={label} ref={nav}>
      <ul ref={list}>
        {items.map((item) => (
          <li key={item.id}>
            <ItemLink item={item} param={param} search={location.search} pathname={location.pathname} current={current === item.id} phone={phone} onGo={go} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ItemLink({
  item,
  param,
  search,
  pathname,
  current,
  phone,
  onGo,
}: {
  item: ContentsItem;
  param: string;
  search: string;
  pathname: string;
  current: boolean;
  phone: boolean;
  onGo(e: MouseEvent, item: ContentsItem): void;
}) {
  const q = new URLSearchParams(search);
  q.set(param, key(item));
  const href = useHref({ pathname, search: `?${q}` });
  return (
    <a href={href} data-for={item.id} aria-current={current ? "location" : undefined} onClick={(e) => onGo(e, item)}>
      {item.letter && <span className="cs-l">{item.letter}</span>}
      {item.letter && " "}
      <span className="cs-n">{item.name}</span>
      {item.count && !phone && (
        <>
          {" "}
          <span className="cs-c">{item.count}</span>
        </>
      )}
    </a>
  );
}
