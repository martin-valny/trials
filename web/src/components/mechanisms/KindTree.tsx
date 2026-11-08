import { useState } from "react";
import type { TreeGroup, TreeKind } from "../../lib/approaches";
import { outcomeColor, type Palette } from "../../lib/explorer";
import type { Outcome } from "../../types";

const fmt = (n: number): string => n.toLocaleString("en-US");
const pct = (r: number): string => `${Math.round(r * 100)}%`;
/** A long group (the Unclassified backlog runs to hundreds of names) shows this many rows until opened. */
export const GROUP_ROWS = 20;

export const trialsWord = (n: number): string => `${fmt(n)} ${n === 1 ? "trial" : "trials"}`;

/** Strip order: the claim (succeeded, red) first, then stopped, completed, running, unknown. */
export const STRIP_ORDER: Outcome[] = ["succeeded", "stopped", "completed_unknown", "running", "unknown"];

const STRIP_WORDS: Record<Outcome, string> = {
  succeeded: "succeeded",
  stopped: "stopped",
  completed_unknown: "completed",
  running: "running",
  unknown: "status unknown",
};

/** "3 running, 1 stopped, 1 succeeded": the strip read out, in strip order, zeros left out. */
export const outcomeWords = (outcomes: Record<Outcome, number>): string =>
  STRIP_ORDER.filter((o) => outcomes[o] > 0)
    .map((o) => `${fmt(outcomes[o])} ${STRIP_WORDS[o]}`)
    .join(", ");

/**
 * A kind's trials by outcome: a 6px square-ended bar whose length is the kind's share of the largest
 * kind in the tree, split by outcome (succeeded in red, the only red). Unknown is a hairline outline,
 * as the map's unknown ring is.
 */
export function OutcomeStrip({
  outcomes,
  n,
  max,
  palette,
}: {
  outcomes: Record<Outcome, number>;
  n: number;
  max: number;
  palette: Palette;
}) {
  return (
    <span className="strip" aria-hidden="true">
      <span className="strip-bar" style={{ width: `${Math.max(2, (n / Math.max(1, max)) * 100)}%` }}>
        {STRIP_ORDER.filter((o) => outcomes[o] > 0).map((o) => (
          <i
            key={o}
            className={o === "unknown" ? "strip-seg ring" : "strip-seg"}
            style={{
              flexGrow: outcomes[o],
              ...(o === "unknown"
                ? { borderColor: outcomeColor(o, palette) }
                : { background: outcomeColor(o, palette) }),
            }}
          />
        ))}
      </span>
    </span>
  );
}

/** "Proposed paracrine immunomodulation" -> "paracrine immunomodulation": the line is marked "proposed" instead. */
const withoutProposed = (text: string): string => text.replace(/^proposed\s+/i, "");

/** A rationale line: marked "proposed", with its source as a quiet link. */
export function Rationale({ text, url }: { text: string; url: string | null }) {
  return (
    <p className="rationale">
      <span className="rationale-tag">proposed</span> {withoutProposed(text)}
      {url ? (
        <>
          {" "}
          <a href={url} target="_blank" rel="noreferrer">
            source
          </a>
        </>
      ) : null}
    </p>
  );
}

/** The share column of a kind row: a percentage, "too few to tell", or nothing when none finished. */
function Share({ kind, defined }: { kind: TreeKind; defined: boolean }) {
  if (!defined || kind.finished === 0) return <span className="kind-share" />;
  return (
    <span className="kind-share">
      {kind.rate !== null ? pct(kind.rate) : <span className="kind-few">too few to tell</span>}
      <span className="visually-hidden">
        {` (${fmt(kind.succeeded)} of ${fmt(kind.finished)} finished trials that could succeed)`}
      </span>
    </span>
  );
}

/**
 * The canvas of an approach without a molecular target: an indented, typeset list, not a graph (a force
 * layout would suggest connections that do not exist). Group headings over kind rows; each row has its
 * trial count, an outcome strip and the success share when the pool allows. A row opens the side panel.
 */
export function KindTree({
  groups,
  selected,
  successDefined,
  palette,
  rationales,
  onSelect,
}: {
  groups: TreeGroup[];
  selected: string | null;
  /** false for Non-drug care: no share column. */
  successDefined: boolean;
  palette: Palette;
  /** Each kind's own rationale and source, shown under its row when its group does not share one. */
  rationales: (key: string) => { text: string; url: string | null } | null;
  onSelect(key: string): void;
}) {
  const max = Math.max(1, ...groups.flatMap((g) => g.kinds.map((k) => k.n)));
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  return (
    <div className="tree">
      {groups.map((g) => {
        // A long group shows its largest rows until opened (always whole when its selected row is further down).
        const whole =
          g.kinds.length <= GROUP_ROWS ||
          open.has(g.group) ||
          g.kinds.findIndex((k) => k.key === selected) >= GROUP_ROWS;
        const rows = whole ? g.kinds : g.kinds.slice(0, GROUP_ROWS);
        const hidden = g.kinds.slice(GROUP_ROWS);
        return (
          <section className="tree-group" key={g.group} aria-label={g.group}>
            <h3 className="tree-h">{g.group}</h3>
            {g.rationale ? <Rationale text={g.rationale} url={g.source_url} /> : null}
            <ul className="tree-kinds">
              {rows.map((k) => {
                const own = g.rationale ? null : rationales(k.key);
                return (
                  <li key={k.key}>
                    <button
                      type="button"
                      className="kind-row"
                      data-kind={k.key}
                      aria-pressed={selected === k.key}
                      aria-controls={selected === k.key ? "side-panel" : undefined}
                      onClick={() => onSelect(k.key)}
                    >
                      <span className="kind-name">
                        <span className="kind-label">{k.label}</span>
                        <span className="kind-leader" aria-hidden="true" />
                      </span>
                      <span className="kind-n">{trialsWord(k.n)}</span>
                      <OutcomeStrip outcomes={k.outcomes} n={k.n} max={max} palette={palette} />
                      <span className="visually-hidden">: {outcomeWords(k.outcomes)}</span>
                      <Share kind={k} defined={successDefined} />
                    </button>
                    {own ? <Rationale text={own.text} url={own.url} /> : null}
                  </li>
                );
              })}
            </ul>
            {!whole ? (
              <button
                type="button"
                className="text-button tree-more"
                onClick={() => setOpen((o) => new Set([...o, g.group]))}
              >
                Show {fmt(hidden.length)} more, {trialsWord(hidden.reduce((a, k) => a + k.n, 0))}
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
