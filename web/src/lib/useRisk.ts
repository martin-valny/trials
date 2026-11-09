import { useEffect, useState } from "react";
import { loadRisk } from "../data";
import type { RiskFile } from "../types";

/** risk.json: undefined while loading, null when the refresh did not write it (or it is unreadable). */
export function useRisk(): RiskFile | null | undefined {
  const [f, setF] = useState<RiskFile | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadRisk()
      .then((x) => live && setF(x))
      .catch(() => live && setF(null));
    return () => {
      live = false;
    };
  }, []);
  return f;
}
