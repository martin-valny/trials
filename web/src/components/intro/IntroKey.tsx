import type { IntroFile } from "../../types";
import { AP_TOKEN, APPROACH_NOTE, undatedCount, undatedNote, type ViewKey } from "../../lib/intro";

const OUTCOME: [string, string][] = [["adv", "moved on"], ["run", "running"], ["stop", "stopped"], ["fin", "finished"], ["unk", "status unknown"]];

function Item({ cls, style, children }: { cls: string; style?: React.CSSProperties; children: string }) {
  return <span><i className={`k-${cls}`} style={style} aria-hidden="true" />{children}</span>;
}

/** The one-line key under the canvas: what the dots in the current view mean. */
export function IntroKey({ view, file }: { view: ViewKey; file: IntroFile | null }) {
  if (view === "approaches") {
    const aps = file?.approaches ?? [];
    return (
      <>
        {aps.map((a) => <Item key={a.key} cls="hue" style={{ background: `var(${AP_TOKEN[a.key] ?? "--fin"})` }}>{a.label}</Item>)}
        <Item cls="multi">More than one approach</Item>
        <span className="intro-keynote">{APPROACH_NOTE}</span>
      </>
    );
  }
  if (view === "changes") return <><Item cls="solid">notable</Item><Item cls="hollow">routine</Item></>;
  if (view === "watchlist") return <><Item cls="run">running</Item><Item cls="dash">typical rate</Item></>;
  const undated = view === "trials" && file ? undatedCount(file) : 0;
  return <>{OUTCOME.map(([c, t]) => <Item key={c} cls={c}>{t}</Item>)}{undated > 0 && <span className="intro-undated">{undatedNote(undated)}</span>}</>;
}
