import { useEffect, useState } from "react";
import { loadMeta } from "../data";
import { isStale } from "../lib/format";
import type { Meta } from "../types";

type State = { state: "loading" } | { state: "unknown" } | { state: "ready"; meta: Meta };

export function FreshnessBadge({ now }: { now?: Date }) {
  const [s, setS] = useState<State>({ state: "loading" });

  useEffect(() => {
    let live = true;
    loadMeta()
      .then((meta) => live && setS(meta ? { state: "ready", meta } : { state: "unknown" }))
      .catch(() => live && setS({ state: "unknown" }));
    return () => {
      live = false;
    };
  }, []);

  if (s.state === "loading") return <span className="badge">Checking freshness…</span>;
  if (s.state === "unknown") return <span className="badge warn">Freshness unknown</span>;

  const { meta } = s;
  const stale = isStale(meta.last_success_at, now ?? new Date());
  return (
    <span className={stale ? "badge warn" : "badge ok"}>
      {stale ? <strong>Data may be stale. </strong> : null}
      Last updated {meta.last_success_at.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC")}
      {" · "}registry data as of {meta.data_timestamp.replace("T", " ")}
    </span>
  );
}
