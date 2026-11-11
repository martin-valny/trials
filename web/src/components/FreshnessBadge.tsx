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
  if (!meta.last_success_at) return <span className="badge warn">Freshness unknown</span>;
  const updated = `Last updated ${meta.last_success_at.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC")}`;
  const registry = meta.data_timestamp ? ` · registry data as of ${meta.data_timestamp.replace("T", " ")}` : "";
  // One quiet header note: the registry date (or the last update when the registry date is missing);
  // full times on hover. A stale refresh adds how old the data is, still no coloured pill.
  const asOf = meta.data_timestamp ?? meta.last_success_at;
  const date = `Registry data from ${dayMonthYear(asOf)}`;
  if (isStale(meta.last_success_at, now ?? new Date())) {
    const days = Math.max(0, Math.floor(((now ?? new Date()).getTime() - Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`)) / 86_400_000));
    return (
      <span className="badge stale" title={`${updated}${registry}`}>
        {date}, {days} {days === 1 ? "day" : "days"} old
      </span>
    );
  }
  return (
    <span className="badge ok" title={`${updated}${registry}`}>
      {date}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-06T10:00:05" -> "6 Nov 2026" (the date as written, no time-zone shift). */
function dayMonthYear(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
