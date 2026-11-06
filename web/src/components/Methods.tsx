import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
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

  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.();
  }, [hash, meta]);

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

      <section id="map" aria-labelledby="map-h">
        <h2 id="map-h">How the map is made</h2>
        <p>
          The Explore map places each trial as a point. Nothing here uses AI; it is all computed
          from registry data.
        </p>

        <h3>What decides where a trial sits</h3>
        <p>Four groups of features, and only these:</p>
        <ul>
          <li>Disease: the condition labels for this area plus the registry MeSH terms.</li>
          <li>Treatment type: drug, device, behavioural and so on.</li>
          <li>Molecule: the cleaned names of the drugs in the experimental arms.</li>
          <li>Population: age bands and sex.</li>
        </ul>
        <p>
          Status, phase, dates, enrollment, results, why stopped, sponsor, sites and outcomes are
          left out of placement, so they can be compared against the map rather than built into it.
        </p>

        <h3>Layout</h3>
        <p>
          The features are projected to three dimensions with UMAP using cosine distance and a fixed
          seed. Each day the new map is aligned to the previous day&apos;s map (rotation,
          reflection and scale), so it stays recognisable from one day to the next.
        </p>

        <h3>What counts as success</h3>
        <p>
          A trial succeeded when it is a completed trial in Early Phase 1 to Phase 2/3, its
          experimental-arm drug had no Phase 3 or 4 trial before it started, and that drug later
          appears in a later-phase tracked trial that started afterwards and was not withdrawn.
        </p>
        <p>Limits:</p>
        <ul>
          <li>
            Only this therapeutic area is tracked, so progress in another indication is missed.
          </li>
          <li>
            A later-phase trial does not prove the earlier one met its endpoint.
          </li>
          <li>
            Phase 3-only and Phase 4 trials get no success label until approval data is added;
            Phase 2/3 trials can succeed.
          </li>
          <li>
            A trial without a drug in an experimental arm cannot succeed by this definition.
          </li>
          <li>
            Recently completed trials have had little time to move on, so recent years undercount success.
          </li>
        </ul>
        <p>Start dates given only to the month are compared as if on the first day of that month.</p>

        <h3>Do successes cluster?</h3>
        <p>
          The comparison uses only finished trials that could succeed: completed, stopped or
          succeeded trials in Early Phase 1 to Phase 2/3 with at least one drug in an experimental
          arm. Panel b&apos;s shares and average use the same trials.
        </p>
        <p>
          For each trial that succeeded we take its 10 nearest neighbours among them by what they
          study (cosine distance). Trials that share any of its drugs are excluded: drugs both place
          trials and define success, so those neighbours would agree by construction. The share of
          neighbours that also succeeded, relative to the average, is compared with the same value
          for 10,000 shuffles of the success labels.
        </p>
        <p>
          The p-value is the share of shuffles that reach the observed value (counting the observed
          one). The map says successes cluster only when it is below 0.025; otherwise it says they
          cluster no more than chance. With fewer than 30 successes the result is withheld.
        </p>
      </section>

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
