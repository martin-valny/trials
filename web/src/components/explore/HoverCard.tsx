import { useLayoutEffect, useRef } from "react";
import { popupLines, popupPosition, type ApproachNames } from "../../lib/explorer";
import type { ExplorerTrial } from "../../types";

/** Clear space (px) between the dot's ring and the card, bridged by the leader. */
const LEADER = 10;

/**
 * Two lines on the trial under the pointer, set centred above its dot inside the map panel (below it
 * only at the panel's top edge), with a 1px ink leader from the card to the dot's ring, like the
 * cluster labels' leaders. It is placed after it is measured, before paint. ``r`` is the ring's radius.
 * ``names`` (the file's approaches and kinds) adds the trial's approach and kind to the facts.
 */
export function HoverCard({
  trial,
  x,
  y,
  r,
  names,
}: {
  trial: ExplorerTrial;
  x: number;
  y: number;
  r: number;
  names?: ApproachNames;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const line = useRef<SVGLineElement>(null);
  const [head, facts] = popupLines(trial, names);
  const title = head.slice(trial.nct_id.length + " · ".length);

  useLayoutEffect(() => {
    const card = ref.current;
    const panel = card?.offsetParent as HTMLElement | null;
    if (!card || !panel) return;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const { left, top, below } = popupPosition(x, y, w, h, panel.clientWidth, panel.clientHeight, r + LEADER);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    // The leader leaves the card's near edge where it is closest to the dot and stops on the ring.
    const ax = Math.min(left + w - 1, Math.max(left + 1, x));
    const ay = below ? top : top + h;
    const d = Math.hypot(ax - x, ay - y) || 1;
    const l = line.current;
    if (!l) return;
    l.setAttribute("x1", String(ax));
    l.setAttribute("y1", String(ay));
    l.setAttribute("x2", String(x + ((ax - x) / d) * r));
    l.setAttribute("y2", String(y + ((ay - y) / d) * r));
  }, [x, y, r, trial]);

  return (
    <>
      <svg className="hover-leader" aria-hidden="true" focusable="false">
        <line ref={line} />
      </svg>
      <div ref={ref} className="hover-card" role="tooltip">
        <p className="hover-card-head">
          <b>{trial.nct_id}</b> · {title}
        </p>
        {facts !== "" && <p className="hover-card-facts">{facts}</p>}
      </div>
    </>
  );
}
