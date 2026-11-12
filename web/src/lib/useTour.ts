import { useCallback, useEffect, useState } from "react";
import type { ViewKey } from "./intro";

const HOLD_ALL = 3200;
const HOLD_VIEW = 4200;

/** Auto-tour through the views: starts on "all", then each key in turn and back. Paused while held, reduced or the tab is hidden. */
export function useTour(keys: ViewKey[], reduced: boolean): { active: ViewKey; held: boolean; hold(k: ViewKey): void; release(): void } {
  const [active, setActive] = useState<ViewKey>("all");
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const keyList = keys.join(",");

  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  useEffect(() => {
    if (held || reduced || hidden) return;
    const list = keyList.split(",") as ViewKey[];
    const id = window.setTimeout(() => setActive(list[(list.indexOf(active) + 1) % list.length] ?? "all"), active === "all" ? HOLD_ALL : HOLD_VIEW);
    return () => window.clearTimeout(id);
  }, [active, held, reduced, hidden, keyList]);

  const hold = useCallback((k: ViewKey) => { setActive(k); setHeld(true); }, []);
  const release = useCallback(() => setHeld(false), []);
  return { active, held, hold, release };
}
