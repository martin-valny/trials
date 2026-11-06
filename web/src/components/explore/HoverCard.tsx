import { useLayoutEffect, useRef } from "react";
import { popupLines, popupPosition } from "../../lib/explorer";
import type { ExplorerTrial } from "../../types";

/**
 * Two lines on the trial under the pointer, set beside it inside the map panel. It is placed after
 * it is measured (before paint), flipping away from the panel's far edges.
 */
export function HoverCard({ trial, x, y }: { trial: ExplorerTrial; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [head, facts] = popupLines(trial);
  const title = head.slice(trial.nct_id.length + " · ".length);

  useLayoutEffect(() => {
    const card = ref.current;
    const panel = card?.offsetParent as HTMLElement | null;
    if (!card || !panel) return;
    const { left, top } = popupPosition(x, y, card.offsetWidth, card.offsetHeight, panel.clientWidth, panel.clientHeight);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }, [x, y, trial]);

  return (
    <div ref={ref} className="hover-card" role="tooltip">
      <p className="hover-card-head">
        <b>{trial.nct_id}</b> · {title}
      </p>
      {facts !== "" && <p className="hover-card-facts">{facts}</p>}
    </div>
  );
}
