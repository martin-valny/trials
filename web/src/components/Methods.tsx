import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { kindTree } from "../lib/approaches";
import { mapLink } from "./mechanisms/SidePanel";
import { loadExplorer, loadMeta, loadPipeline } from "../data";
import type { ExplorerFile, Meta, PipelineFile } from "../types";

const REPO = "https://github.com/martin-valny/trials/blob/main/";

/** A share from the exported cluster config as a whole percentage, or the default when absent. */
const pc = (v: number | undefined, fallback: number): string => `${Math.round(100 * (v ?? fallback))}%`;

/** Rows shown per group before "Show all". */
const LIST_ROWS = 10;

/** One group of the not-yet-categorised list: names with trial counts, long ones behind a toggle. */
function NotYetGroup({ group, kinds }: { group: string; kinds: { key: string; label: string; n: number; trials: string[] }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? kinds : kinds.slice(0, LIST_ROWS);
  const ncts = [...new Set(kinds.flatMap((k) => k.trials))];
  return (
    <section aria-label={group}>
      <h4>
        {group} <span className="side-muted">({ncts.length} {ncts.length === 1 ? "trial" : "trials"})</span>
      </h4>
      <ul>
        {shown.map((k) => (
          <li key={k.key}>
            {k.label} <span className="side-muted">{k.n} {k.n === 1 ? "trial" : "trials"}</span>
          </li>
        ))}
      </ul>
      {kinds.length > LIST_ROWS ? (
        <button type="button" className="text-button" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${kinds.length}`}
        </button>
      ) : null}
      <p>
        <Link to={mapLink(ncts, `Not yet categorised: ${group}`)}>Show these trials on the map</Link>
      </p>
    </section>
  );
}

export function Methods() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [file, setFile] = useState<ExplorerFile | null>(null);
  const [pipeline, setPipeline] = useState<PipelineFile | null>(null);
  const method = file?.method ?? null;

  useEffect(() => {
    let live = true;
    loadMeta()
      .then((m) => live && setMeta(m))
      .catch(() => undefined);
    // Only for the cluster parameters the map was built with; the page reads fine without them.
    loadExplorer()
      .then((f) => live && setFile(f ?? null))
      .catch(() => undefined);
    loadPipeline()
      .then((p) => live && setPipeline(p ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.();
  }, [hash, meta, file, pipeline]);

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

      <section id="advanced" aria-labelledby="advanced-h">
        <h2 id="advanced-h">Advanced to next phase, and its time bias</h2>
        <p>
          A trial &ldquo;advanced to next phase&rdquo; when the drug it tested was later tested in a
          higher phase, in the same disease, in a trial that was not withdrawn. The exact rule is
          under &ldquo;What counts as success&rdquo; below. Advancing is not approval, and it does not
          show the earlier trial met its endpoint.
        </p>
        <p>
          The measure leans against recent trials: a trial that finished recently can&apos;t have advanced yet,
          because the next phase takes years to register. The most recent years therefore show fewer
          advances than they will eventually have, and the figure marks a trial as still running
          or finished, no follow-on rather than as a failure.
        </p>
      </section>

      <section id="registry-only" aria-labelledby="registry-only-h">
        <h2 id="registry-only-h">Registered trials only</h2>
        <p>
          Everything here comes from trials registered on ClinicalTrials.gov. A drug can be in
          development without a registered trial in these diseases, or be tested in a registry we do
          not read (for example in China, the EU or Japan), and neither shows up. A drug that
          advanced only in such a trial is shown as not having advanced. Read the Pipeline as the
          registered record, not as a complete list of what companies are doing.
        </p>
      </section>

      <section id="rows-and-companies" aria-labelledby="rows-and-companies-h">
        <h2 id="rows-and-companies-h">How rows and companies are assigned</h2>
        <p>
          Each Pipeline row is a target class. For every drug trial in Phase 1 to Phase 4 (trials with
          no phase are skipped), the experimental drugs are taken; drugs in the background list are
          dropped unless that would leave nothing; each remaining drug goes to the row that names it,
          or else to the row that holds its mechanism class. A combination of two targeted drugs sits
          in both rows, and each placement remembers the drug that put it there. Headline totals count
          a trial once.
        </p>
        <p>
          Companies are grouped under a parent: the registry&apos;s sponsor names are normalised for case,
          punctuation and legal suffix, then matched against a hand-kept list, so &ldquo;Novartis
          Pharmaceuticals&rdquo; and &ldquo;Novartis&rdquo; are one company. The files, all hand-kept and
          read by the daily run:
        </p>
        <ul>
          <li>
            <a href={`${REPO}config/pipeline/rows.csv`}>config/pipeline/rows.csv</a>: the rows, with their
            classes and drugs.
          </li>
          <li>
            <a href={`${REPO}config/pipeline/background.csv`}>config/pipeline/background.csv</a>: drugs that
            never put a trial in a row when it has another experimental drug (conditioning chemotherapy,
            steroids given alongside).
          </li>
          <li>
            <a href={`${REPO}config/pipeline/unrowed.csv`}>config/pipeline/unrowed.csv</a>: classes that are
            deliberately not a row (below).
          </li>
          <li>
            <a href={`${REPO}config/sponsors/parents.csv`}>config/sponsors/parents.csv</a>: which parent a
            sponsor belongs to.
          </li>
          <li>
            <a href={`${REPO}config/stop_reasons.csv`}>config/stop_reasons.csv</a>: how a free-text reason
            for stopping is grouped.
          </li>
        </ul>
        <h3>Known limit: comparator drugs</h3>
        <p>
          Some trials list a comparator or background therapy inside an experimental arm (for example
          &ldquo;interferon or glatiramer&rdquo; in a switch study). The background list catches the
          spellings seen so far, so a trial of a studied drug against interferon-&beta;, glatiramer or
          a corticosteroid sits in the studied drug&apos;s row only. Two trials still sit in two rows,
          because one intervention name holds both drugs. They count in each row and once in the
          headline totals:
        </p>
        <ul>
          <li>
            <a href="https://clinicaltrials.gov/study/NCT00168766">NCT00168766</a>: &ldquo;interferon-beta-1a
            plus methylprednisolone&rdquo; (Interferon-&beta; and Glucocorticoids).
          </li>
          <li>
            <a href="https://clinicaltrials.gov/study/NCT00771043">NCT00771043</a>: &ldquo;tysabri and
            avonex&rdquo; (&alpha;4-integrin and Interferon-&beta;).
          </li>
        </ul>
        <p>
          A trial whose only experimental drug is a listed background drug still defines its row. A trial
          of a background drug plus a drug that maps to no row has no mark.
        </p>
      </section>

      <section id="unrowed" aria-labelledby="unrowed-h">
        <h2 id="unrowed-h">Drug classes not shown as a row</h2>
        {pipeline ? (
          <>
            <p>
              {pipeline.counts.targeted_not_rowed.toLocaleString("en-US")} of{" "}
              {pipeline.counts.targeted.toLocaleString("en-US")} targeted-drug trials are in no row.
              The classes below are deliberately not shown as a row; other trials with no row are
              counted in the &ldquo;not grouped&rdquo; figure on the Pipeline.
            </p>
            {pipeline.unrowed.length ? (
              <ul>
                {pipeline.unrowed.map((u) => (
                  <li key={u.class}>
                    {u.class}{" "}
                    <span className="side-muted">
                      {u.trials.toLocaleString("en-US")} {u.trials === 1 ? "trial" : "trials"}: {u.reason}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No class is left out on purpose in this run.</p>
            )}
          </>
        ) : (
          <p>The list is unavailable right now.</p>
        )}
      </section>

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
          in the Drug target class and Drug format filters, in their counts, and in panel b&apos;s groups. On
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
          is listed as not yet categorised. On the 6 November 2026 snapshot (2,987 trials; a trial counts
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
            Not yet categorised: 570. Trials in no other approach: not a treatment (diagnostics,
            sampling; 121) or not yet sorted (449, of which 13 have no experimental treatment listed).
          </li>
        </ul>
        <p>
          Coverage, as two numbers: every drug is sorted (molecular, a kind, or not a drug) for
          1,121 of 1,314 drug-bearing trials (85.3%), and 2,156 of 2,987 trials (72.2%) are in an
          approach other than Not yet categorised.
        </p>
        <p>
          Each kind carries a one-line rationale with a source (MeSH, NCI Thesaurus, a review or a
          label). It is marked &ldquo;Thought to work by:&rdquo;: it says why the treatment might work, not a mechanism, and
          it is never drawn as a molecular target or pathway.
        </p>
        <p>
          Success keeps its definition (below), so non-drug trials are never in the pool. When a
          trial tested several treatments, it counts in every group it touches, but its advance is
          counted for the drug that advanced: an aHSCT trial that succeeded because its
          cyclophosphamide moved to a later phase counts as a success for alkylating agents and
          Targeted drugs, not for Cell &amp; transplant. Panel b&apos;s By mechanism, By modality and By
          approach views all follow this rule; By disease keeps the per-disease rule.
        </p>
        <p>
          A later addition may tag treatments that work as a pulsed immune reset against those
          given continuously (Sorensen &amp; Sellebjerg, 2019), across the approaches.
        </p>

        <h3 id="not-yet-categorised">Not yet categorised</h3>
        <p>
          A trial that lands in none of the approaches above is not yet categorised. It is not an
          approach to open, so the Approaches page leaves it out of the rail and notes how many
          there are; on the map it stays a filter value, last in every list.
        </p>
        <ul>
          <li>
            Unsorted names: a drug or intervention name that is not in the drug mapping, the kind
            table or the keyword rules. Each is a mapping still to decide, so none is guessed from
            how it ends.
          </li>
          <li>
            Diagnostic or not a treatment: sampling, imaging and diagnostic studies, and trials
            with no experimental treatment listed (placebo or usual care only).
          </li>
        </ul>
        {file
          ? kindTree("unclassified", file.trials, file, file.method.min_group).map((g) => (
              <NotYetGroup key={g.group} group={g.group} kinds={g.kinds} />
            ))
          : null}
        <p>
          How we sort is above: a drug with a molecular mechanism is Targeted, a drug without one
          carries a kind, and a non-drug intervention is sorted by a reviewed list of phrases, then
          by its registry type.
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

        <section id="map-statistic" aria-labelledby="map-statistic-h">
        <h3 id="map-statistic-h">Do successes cluster?</h3>
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
