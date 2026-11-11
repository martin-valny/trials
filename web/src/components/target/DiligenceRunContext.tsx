import { createContext, useContext, type ReactNode } from "react";
import { useDiligenceRun, type DiligenceRun } from "../../lib/useDiligenceRun";
import type { PipelineRow } from "../../types";

const Ctx = createContext<DiligenceRun | null>(null);

/** One diligence run shared by the diligence panel and the header strip. The provider is not keyed: when the target or disease
 *  changes, useDiligenceRun resets its own state and aborts the poll it was running, so nothing needs a remount. */
export function DiligenceRunProvider({ row, disease, children }: { row: PipelineRow; disease: string | null; children: ReactNode }) {
  return <Ctx.Provider value={useDiligenceRun(row, disease)}>{children}</Ctx.Provider>;
}

export function useDiligence(): DiligenceRun {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDiligence must be used inside DiligenceRunProvider");
  return v;
}
