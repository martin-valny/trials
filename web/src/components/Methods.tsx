import { useEffect, useState } from "react";
import { loadMeta } from "../data";
import type { Meta } from "../types";

export function Methods() {
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    let live = true;
    loadMeta()
      .then((m) => live && setMeta(m))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <article>
      <h1>Methods</h1>

      <h2>What is tracked</h2>
      <p>
        Interventional studies registered on ClinicalTrials.gov for these conditions
        {meta ? ` (${meta.area})` : ""}:
      </p>
      {meta ? (
        <ul>
          {meta.conditions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : (
        <p>The condition list is unavailable right now.</p>
      )}
      <p>
        A study is included when one of its listed conditions, keywords or MeSH terms matches a
        configured condition name as a whole phrase. Titles are not used.
      </p>

      <h2>How changes are detected</h2>
      <p>
        Once a day the full set is downloaded and compared with the previous day. A change row is
        recorded when a tracked field differs after normalising text (case, whitespace, sponsor and
        intervention name aliases). Cosmetic edits do not create rows.
      </p>

      <h2>Limitations</h2>
      <ul>
        <li>
          Registry data lags real events: sponsors update records on their own schedule, so a change
          may be detected days or weeks after it happened.
        </li>
        <li>
          Everything shown is self-reported by sponsors. Trial Radar does not verify it and this is
          not medical advice.
        </li>
        <li>
          Trials that list only an abbreviation (for example a two-letter acronym) as their condition are missed.
        </li>
        <li>History starts on the first day of tracking; earlier changes are not reconstructed.</li>
        <li>No AI is used in this version; every value comes from the registry record.</li>
      </ul>
    </article>
  );
}
