import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { TreeKind } from "../../lib/approaches";
import { outcomeLabel } from "../../lib/format";
import type { ExplorerTrial } from "../../types";
import { outcomeWords, Rationale, trialsWord } from "./KindTree";

const fmt = (n: number): string => n.toLocaleString("en-US");

/** The map, narrowed to these trials (Explore's ``?nct=`` list), with where they came from. */
export const mapLink = (ncts: string[], from: string): string =>
  `/explore?${new URLSearchParams({ nct: ncts.join(","), from }).toString()}`;

/**
 * Panel c: one kind's trials. Its rationale (marked proposed, with its source), its counts, "Show these
 * trials on the map", and every trial with a link to its page. Beside the canvas on wide screens, a
 * bottom sheet on narrow ones. Escape or Close hands focus back to the row that opened it.
 */
export function SidePanel({
  kind,
  group,
  approach,
  rationale,
  trials,
  successDefined,
  onClose,
}: {
  kind: TreeKind;
  group: string;
  approach: string;
  rationale: { text: string; url: string | null } | null;
  /** The kind's trials, in kind.trials order. */
  trials: ExplorerTrial[];
  successDefined: boolean;
  onClose(): void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [kind.key]);

  return (
    <aside
      className="side-panel"
      id="side-panel"
      aria-labelledby="side-h"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="side-head">
        <h2 className="panel-h" id="side-h" ref={heading} tabIndex={-1}>
          <span className="panel-l">c</span>
          {kind.label}
        </h2>
        <button type="button" className="text-button side-close" onClick={onClose}>
          Close<span className="visually-hidden"> {kind.label}</span>
        </button>
      </div>
      <p className="side-meta">
        {approach} › {group}
      </p>
      <p className="side-counts">
        {trialsWord(kind.n)}: {outcomeWords(kind.outcomes)}.
        {successDefined && kind.finished > 0 ? (
          <>
            {" "}
            {fmt(kind.finished)} in the success pool, {fmt(kind.succeeded)} succeeded
            {kind.rate === null ? " (too few to tell)" : ""}.
          </>
        ) : null}
      </p>
      {rationale ? <Rationale text={rationale.text} url={rationale.url} /> : null}
      <p className="side-map">
        <Link to={mapLink(kind.trials, kind.label)}>Show these trials on the map</Link>
      </p>
      <ul className="side-trials">
        {trials.map((t) => (
          <li key={t.nct_id}>
            <Link to={`/trial/${t.nct_id}`} className="side-nct">
              {t.nct_id}
            </Link>{" "}
            <span className="side-title">{t.title}</span>
            <span className="side-outcome"> · {outcomeLabel(t.outcome)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
