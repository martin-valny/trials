import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { loadExplorer, loadMeta } from "../data";
import type { ExplorerFile, Meta } from "../types";

const REPO = "https://github.com/martin-valny/trials/blob/main/";

export function Methods() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [method, setMethod] = useState<ExplorerFile["method"] | null>(null);

  useEffect(() => {
    let live = true;
    loadMeta()
      .then((m) => live && setMeta(m))
      .catch(() => undefined);
    // Only for the cluster parameters the map was built with; the page reads fine without them.
    loadExplorer()
      .then((f) => live && setMethod(f?.method ?? null))
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
        <p>Five groups of features, and only these:</p>
        <ul>
          <li>Disease: the condition labels for this area plus the registry MeSH terms.</li>
          <li>Treatment type: drug, device, behavioural and so on.</li>
          <li>Molecule: the cleaned names of the drugs in the experimental arms.</li>
          <li>Mechanism: the mechanism classes and targets of those drugs (see below).</li>
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

        <h3 id="mechanisms">Drug mechanisms</h3>
        <p>
          Each experimental drug is matched to its mechanism of action, molecular targets and
          modality in <a href="https://www.ebi.ac.uk/chembl/">ChEMBL</a> (release ChEMBL_37),
          licensed under <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>;
          the derived mapping is shared under the same licence. A drug name matches only exactly
          (ignoring case) against a ChEMBL preferred name or synonym: no fuzzy matching, and
          nothing is guessed from how a name ends. Salts and prodrugs roll up to the parent
          molecule. A short hand-written list fixes name variants, brands and codes and marks
          non-drugs; it always wins. The mapping is made by hand from time to time; the daily
          update never calls ChEMBL.
        </p>
        <p>
          At the last mapping (6 November 2026) every drug was resolved for 838 of 1,314
          drug-bearing trials (63.8%), giving 182 mechanism classes. A class is named from the
          target and the action, for example &ldquo;anti-CD20&rdquo; or &ldquo;S1P receptor
          modulator&rdquo;.
        </p>
        <p>
          In the layout the mechanism block has weight 1.0, the same as the other blocks. It is the
          smallest weight at which the large drug groups split by mechanism class (an anti-CD20
          group appears, 100% of its drug trials in that class) while every group keeps a
          dominant disease; at 1.5 the diseases start to dissolve into mixed groups. The tables are
          in the{" "}
          <a href={`${REPO}docs/superpowers/research/2026-11-06-mechanism-weight.md`}>
            weight research note
          </a>
          .
        </p>
        <p>
          A trial can carry several mechanisms or modalities. It counts in each group it touches:
          in the Mechanism and Modality filters, in their counts, and in panel b&apos;s groups. On
          the map such a trial is drawn as a hollow ring, not given one class&apos;s colour. Panel
          b shows a share for a group only from 10 finished trials; below that the bar is an
          outline and says it is too few to tell. There are no per-group p-values.
        </p>
        <h4>What is not mapped</h4>
        <ul>
          <li>
            Drugs ChEMBL does not know by that exact name, or knows without a mechanism record
            (for example glatiramer and immunoglobulin), stay unmapped rather than guessed.
          </li>
          <li>
            Cell products and procedures without a molecular target (stem cells, transplants,
            conditioning regimens) and most vaccines are not given a class.
          </li>
          <li>
            Names that would match two different molecules stay unmapped until resolved by hand.
          </li>
          <li>
            Many names appear in a single trial each; they are left for later rather than guessed.
          </li>
        </ul>
        <p>Trials with no known mechanism are shown as such, never folded into a class.</p>

        <h3 id="clusters">Named clusters</h3>
        <p>
          The labelled regions on the map are clusters found by HDBSCAN on the trials&apos; 3D
          map positions
          {method?.clusters
            ? ` (min_cluster_size ${method.clusters.min_cluster_size}, min_samples ${method.clusters.min_samples})`
            : ""}
          ; trials in no cluster are left unlabelled. A name has a disease part and a middle part:
        </p>
        <ul>
          <li>
            Disease: the condition most members list first, when it holds at least 60% of the
            members; otherwise the top two together if they reach 60%; otherwise
            &ldquo;Mixed diseases&rdquo;.
          </li>
          <li>
            Middle: the top mechanism class, when it covers at least 40% of the members that have
            drugs and at least 25% of all its members, so a few drug trials cannot name a cluster
            of non-drug trials; otherwise the top intervention type when it covers half the
            members; otherwise &ldquo;mixed&rdquo;.
          </li>
          <li>
            The commonest drug is added in brackets when it is in at least 15% of the members
            (for a mechanism name, counted among that class only).
          </li>
        </ul>
        <p>
          The map labels at most eight clusters (six on a phone), each with at least 15 trials,
          each name once, mechanism-named clusters first.
        </p>

        <h3>What counts as success</h3>
        <p>
          A trial succeeded when it is a completed trial in Early Phase 1 to Phase 2/3, its
          experimental-arm drug had no Phase 3 or 4 trial in the same disease before it started,
          and it was followed by a later, higher-phase trial of the same drug in the same disease
          that was not withdrawn. A trial listed under several diseases succeeds only in those
          where the drug moved on.
        </p>
        <p>Limits:</p>
        <ul>
          <li>
            Only this therapeutic area is tracked, so progress in another indication is missed.
          </li>
          <li>
            Progress in another disease within this area is deliberately not counted: a trial
            succeeds only where its drug moved on in the same disease.
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
