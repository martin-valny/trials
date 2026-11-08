import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { loadExplorer, loadMeta } from "../data";
import type { ExplorerFile, Meta } from "../types";

const REPO = "https://github.com/martin-valny/trials/blob/main/";

/** A share from the exported cluster config as a whole percentage, or the default when absent. */
const pc = (v: number | undefined, fallback: number): string => `${Math.round(100 * (v ?? fallback))}%`;

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
          At the last mapping (8 November 2026) every drug was resolved for 1,112 of 1,314
          drug-bearing trials (84.6%), giving 201 mechanism classes. A class is named from the
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
          b shows a percentage for a group only from 10 finished trials; below that it shows no
          percentage, only an outline bar, the counts (for example 1/5) and &ldquo;too few to
          tell&rdquo;. There are no per-group p-values.
        </p>
        <h4>What is not mapped</h4>
        <ul>
          <li>
            Drugs ChEMBL does not know by that exact name stay unmapped rather than guessed.
          </li>
          <li>
            Products ChEMBL knows without a molecular target (for example glatiramer and
            immunoglobulin), cell products and procedures (stem cells, transplants) are not given a
            mechanism class; they are sorted into approaches instead (next section). Most vaccines
            are not given a class.
          </li>
          <li>
            Names that would match two different molecules stay unmapped until resolved by hand.
          </li>
          <li>
            Many names appear in a single trial each; they are left for later rather than guessed.
          </li>
        </ul>
        <p>Trials with no known mechanism are shown as such, never folded into a class.</p>

        <h3 id="approaches">Treatments without a molecular target</h3>
        <p>
          Many treatments in these diseases have no single molecular target: stem-cell
          transplants, mesenchymal cells, immunoglobulin, plasma exchange, peptide tolerisation,
          glatiramer, and every non-drug trial (rehabilitation, devices, diet, behavioural care).
          They are not forced into a mechanism class. Other sources do the same: Open Targets
          leaves vaccines, blood products and cell therapies out of its target layer, ChEMBL records
          glatiramer and immunoglobulin with no target rather than leaving them blank, and the MeSH
          Therapeutics tree (E02) groups treatments by system, such as cell- and tissue-based
          therapy, plasmapheresis, rehabilitation and nutrition therapy.
        </p>
        <p>
          Instead every trial is sorted into one or more of seven approaches. The rule: a drug with
          a molecular mechanism (a gene target, or a defined action on DNA or RNA, as for
          cladribine) is a Targeted drug. A drug without one carries a kind (for example aHSCT or
          mesenchymal stem cells) written once in a hand-made table, each with its approach. A
          non-drug intervention is sorted by a reviewed list of whole-word phrases, then by its
          registry intervention type. A trial with no experimental arm is sorted by all its interventions, placebo and usual care aside (its drugs still do not count in the success share). Nothing is guessed from how a name ends; a name nothing sorts
          is listed as not yet sorted. On the 6 November 2026 snapshot (2,987 trials; a trial counts
          in each approach it is in):
        </p>
        <ul>
          <li>Targeted drugs: 1,062 trials. Drugs with a molecular mechanism; these open into the mechanism graph.</li>
          <li>Cell &amp; transplant: 72. aHSCT, mesenchymal and other cell products.</li>
          <li>Antibody &amp; plasma: 58. Immunoglobulin, plasma exchange, immunoadsorption, ATG.</li>
          <li>Tolerisation: 15. Myelin and AChR peptides, helminths.</li>
          <li>Broad immunomodulators: 52. A stated effect but no defined target, such as glatiramer.</li>
          <li>Non-drug care: 1,222. Rehabilitation, devices, behavioural care, diet, procedures.</li>
          <li>
            Unclassified: 570. Trials in no other approach: not a treatment (diagnostics,
            sampling; 121) or not yet sorted (449, of which 13 have no experimental treatment listed).
          </li>
        </ul>
        <p>
          Coverage, as two numbers: every drug is sorted (molecular, a kind, or not a drug) for
          1,121 of 1,314 drug-bearing trials (85.3%), and 2,156 of 2,987 trials (72.2%) are in an
          approach other than Unclassified.
        </p>
        <p>
          Each kind carries a one-line rationale with a source (MeSH, NCI Thesaurus, a review or a
          label). It is marked proposed: it says why the treatment might work, not a mechanism, and
          it is never drawn as a molecular target or pathway.
        </p>
        <p>
          Success keeps its definition (below), so non-drug trials are never in the pool. When a
          trial tested several treatments, it counts in every group it touches, but its success is
          credited to the drug that moved on: an aHSCT trial that succeeded because its
          cyclophosphamide moved to a later phase counts as a success for alkylating agents and
          Targeted drugs, not for Cell &amp; transplant. Panel b&apos;s By mechanism, By modality and By
          approach views all follow this rule; By disease keeps the per-disease rule.
        </p>
        <p>
          A later addition may tag treatments that work as a pulsed immune reset against those
          given continuously (Sorensen &amp; Sellebjerg, 2019), across the approaches.
        </p>

        <h3 id="clusters">Named clusters</h3>
        <p>
          The labelled regions on the map are clusters found by HDBSCAN on the trials&apos; 3D
          map positions
          {method?.clusters
            ? ` (min_cluster_size ${method.clusters.min_cluster_size}, min_samples ${method.clusters.min_samples})`
            : ""}
          ; trials in no cluster are left unlabelled. A cluster&apos;s label is anchored on the
          member nearest the cluster&apos;s median position (not its densest point, as first
          planned): every cluster then has a well-defined anchor inside it. Disease labels, by
          contrast, sit at each condition&apos;s own densest region. A name has a disease part and
          a middle part:
        </p>
        <ul>
          <li>
            Disease: the condition most members list first, when it holds at least{" "}
            {pc(method?.clusters?.disease_share, 0.6)} of the members; otherwise the top two together
            if they reach {pc(method?.clusters?.disease_share, 0.6)}; otherwise
            &ldquo;Mixed diseases&rdquo;.
          </li>
          <li>
            Middle: the top mechanism class, when it covers at least{" "}
            {pc(method?.clusters?.mechanism_share, 0.4)} of the members that have drugs and at least{" "}
            {pc(method?.clusters?.mechanism_min_overall, 0.25)} of all its members, so a few drug
            trials cannot name a cluster of non-drug trials; otherwise the top intervention type
            when it covers at least {pc(method?.clusters?.type_share, 0.5)} of the members;
            otherwise &ldquo;mixed&rdquo;.
          </li>
          <li>
            The commonest drug is added in brackets when it is in at least{" "}
            {pc(method?.clusters?.drug_share, 0.15)} of the members
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
          The question is whether trials that study similar things succeed together, so the
          neighbours are found on disease, treatment type, molecule and population only; the
          mechanism block shapes the map but is left out here (which mechanisms work is what panel
          b&apos;s By mechanism view shows). For each trial that succeeded we take its 10 nearest
          neighbours among them by what they study (cosine distance). Trials that share any of its drugs are excluded: drugs both place
          trials and define success, so those neighbours would agree by construction. The share of
          neighbours that also succeeded, relative to the average, is compared with the same value
          for 10,000 shuffles of the success labels.
        </p>
        <p>
          The p-value is the share of shuffles that reach the observed value (counting the observed
          one). The map says successes cluster only when it is below 0.025; otherwise it says they
          cluster no more than chance. With fewer than 30 successes the result is withheld.
        </p>
        <p>
          On the 6 November 2026 snapshot this gives a lift of 1.32 (shuffled labels 0.62&ndash;1.41,
          p = 0.061): no more than chance. Had the mechanism block been included, the same snapshot
          would give 0.71 (p = 0.94).
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
