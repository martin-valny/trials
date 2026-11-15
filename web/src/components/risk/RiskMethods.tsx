// Methods, "How good is the stop-risk model?" (spec 6.4, 7). Every figure comes from risk.json's model block;
// the only fixed numbers are the recipe's own rules and the dated notes on the text experiment and calibration.
import { useId } from "react";
import type { RiskComparison, RiskComparisonMetrics, RiskMetrics, RiskModelInfo } from "../../types";
import "./risk.css";

/** Below this many trials a row reads "too few to judge" and shows no numbers. */
const MIN_N = 100;
/** Below this many it shows its numbers muted, as "too few to judge on its own" (seeds swing it by ±0.03). */
const OWN_N = 300;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11-09" -> "9 November 2026"; anything else unchanged. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** "2021-12-01" -> "December 2021"; anything else unchanged. */
export function monthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

const year = (iso: string): string => iso.slice(0, 4);
const int = (n: number): string => n.toLocaleString("en-US");
const pct = (p: number): string => `${Math.round(p * 100)}%`;

/** The excluded fields, enrollment first (the one people most expect to see used). */
function excludedFirst(list: readonly string[]): string[] {
  const enrol = list.filter((x) => /enroll?ment/i.test(x));
  return [...enrol, ...list.filter((x) => !enrol.includes(x))];
}

interface Row {
  key: string;
  label: string;
  m: RiskComparisonMetrics | null;
  /** Only the area subset is small enough to need the "too few" rules. */
  small?: boolean;
}

/** One row of the accuracy table. */
function MetricRow({ row }: { row: Row }) {
  const { m } = row;
  if (!m || (row.small && m.n < MIN_N))
    return (
      <tr data-row={row.key}>
        <th scope="row">{row.label}</th>
        <td>{m ? int(m.n) : "—"}</td>
        <td colSpan={2} className="rk-m-few">
          too few to judge
        </td>
      </tr>
    );
  const own = Boolean(row.small) && m.n < OWN_N;
  return (
    <tr data-row={row.key} className={own ? "rk-m-muted" : undefined}>
      <th scope="row">
        {row.label}
        {own ? <span className="rk-m-few"> (too few to judge on its own)</span> : null}
      </th>
      <td>
        {int(m.n)} <span className="rk-m-sub">({int(m.positives)} stopped)</span>
      </td>
      <td>{m.auc === null ? "—" : m.auc.toFixed(3)}</td>
      <td>{m.brier.toFixed(3)}</td>
    </tr>
  );
}

/** Predicted against observed share stopped, one point per tenth of the test set, with the diagonal for reference. */
function CalibrationChart({ m, label }: { m: RiskMetrics; label: string }) {
  const id = useId();
  const pts = m.calibration;
  const top = Math.max(0.1, Math.ceil(Math.max(...pts.map((c) => Math.max(c.p, c.observed))) * 10) / 10);
  const W = 300;
  const H = 260;
  const L = 44;
  const R = 12;
  const T = 10;
  const B = 40;
  const x = (v: number) => L + (v / top) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const ticks = Array.from({ length: Math.round(top * 10) + 1 }, (_, i) => i / 10);
  const desc = pts.map((c) => `predicted ${pct(c.p)}, observed ${pct(c.observed)} (${int(c.n)} trials)`).join("; ");
  return (
    <figure className="rk-m-fig">
      <svg
        role="img"
        viewBox={`0 0 ${W} ${H}`}
        className="rk-m-cal"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
      >
        <title id={`${id}-t`}>Calibration of the {label} on later trials</title>
        <desc id={`${id}-d`}>
          Each point is a tenth of the test trials, sorted by estimate. {desc}. Points on the diagonal would mean the
          estimates match what happened.
        </desc>
        {ticks.map((t) => (
          <g key={t} className="rk-m-tick">
            <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(0) + 4} />
            <line x1={x(0) - 4} x2={x(0)} y1={y(t)} y2={y(t)} />
            <text x={x(t)} y={y(0) + 15} textAnchor="middle">
              {pct(t)}
            </text>
            <text x={x(0) - 7} y={y(t) + 4} textAnchor="end">
              {pct(t)}
            </text>
          </g>
        ))}
        <line className="rk-m-axis" x1={x(0)} x2={x(top)} y1={y(0)} y2={y(0)} />
        <line className="rk-m-axis" x1={x(0)} x2={x(0)} y1={y(0)} y2={y(top)} />
        <line data-ref="diagonal" className="rk-m-diag" x1={x(0)} y1={y(0)} x2={x(top)} y2={y(top)} />
        <polyline className="rk-m-line" points={pts.map((c) => `${x(c.p)},${y(c.observed)}`).join(" ")} />
        {pts.map((c, i) => (
          <circle key={i} className="rk-m-pt" cx={x(c.p)} cy={y(c.observed)} r={3.5} />
        ))}
        <text className="rk-m-lab" x={(x(0) + x(top)) / 2} y={H - 4} textAnchor="middle">
          Estimated chance of stopping early
        </text>
        <text
          className="rk-m-lab"
          transform={`translate(11 ${(y(0) + y(top)) / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          Share that stopped early
        </text>
      </svg>
      <figcaption>
        Estimated chance against the share that actually stopped early, for the {label} on the test trials; the dashed
        line is a perfect match. Points above the line mean more trials stopped than estimated.
      </figcaption>
    </figure>
  );
}

/** Test trials left out of the v2 comparison, by the pipeline's reason keys, in its order. */
const EXCLUSION_LABEL: Record<string, string> = {
  running: "still running",
  unknown: "of unknown status",
  withdrawn: "withdrawn",
  suspended: "suspended",
  missing: "missing from the last snapshot",
  other: "left out for other reasons",
};

/** "300 still running, 40 of unknown status and 20 withdrawn"; empty reasons are skipped. */
function exclusionList(ex: Record<string, number>): string {
  const keys = [...Object.keys(EXCLUSION_LABEL), ...Object.keys(ex).filter((k) => !(k in EXCLUSION_LABEL))];
  const parts = keys.filter((k) => (ex[k] ?? 0) > 0).map((k) => `${int(ex[k]!)} ${EXCLUSION_LABEL[k] ?? k}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "none");
}

/** Snapshot range and processing date: from the card's data_source when risk.json carries it, else the
 * comparison's outcome snapshot (the last one, and the date its data were processed). */
function creditDates(model: RiskModelInfo, cmp: RiskComparison): { first: string | null; last: string; processed: string } {
  const iso = model.data_source?.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  if (iso.length >= 3) return { first: iso[0]!, last: iso[1]!, processed: iso[2]! };
  return { first: null, last: cmp.outcome_snapshot, processed: cmp.outcome_snapshot };
}

/** The credit line ClinicalTrials.gov's terms and CTTI's citation policy ask for (v2 spec 10). */
function Credit({ model, cmp }: { model: RiskModelInfo; cmp: RiskComparison }) {
  const d = creditDates(model, cmp);
  return (
    <p className="rk-m-note" data-credit>
      Data: <a href="https://clinicaltrials.gov/">ClinicalTrials.gov</a>, via{" "}
      <a href="https://aact.ctti-clinicaltrials.org/">AACT</a> (
      <a href="https://ctti-clinicaltrials.org/">Clinical Trials Transformation Initiative</a>), snapshots{" "}
      {d.first ? `${monthYear(d.first)} to ${monthYear(d.last)}` : `up to ${monthYear(d.last)}`}, processed{" "}
      {longDate(d.processed)}.
    </p>
  );
}

/** The before/after table: the models on the held-out trials running at the cutoff. On a v2 card the area row
 * is v2's; on a v1 card (v2 did not ship) it is the live v1 model's, on its own test years. */
function BeforeAfter({ model, cmp, area }: { model: RiskModelInfo; cmp: RiskComparison; area: string | null }) {
  const isV2 = model.feature_set === "v2";
  const used = isV2 && cmp.v2_ships ? model.shipped : null;
  const where = area ? ` (${area})` : "";
  const rows: Row[] = [
    { key: "v1_recipe", label: "Earlier model (v1), same trials", m: cmp.v1_recipe },
    ...(cmp.v1_committed
      ? [{ key: "v1_committed", label: "Earlier model as published, subset: test trials it never saw", m: cmp.v1_committed }]
      : []),
    { key: "v2_baseline", label: `New baseline: phase, sponsor type and trial age${used === "baseline" ? ", used on the site" : ""}`, m: cmp.v2_baseline },
    { key: "v2", label: `New model (v2)${used === "boosted" ? ", used on the site" : ""}`, m: cmp.v2 },
    { key: "v2_no_sites", label: "v2 without site and country features", m: cmp.v2_no_sites },
    { key: "v2_history", label: "v2 plus edit history (not used)", m: cmp.v2_history },
    isV2
      ? { key: "in_area", label: `v2, subset: trials in this area only${where}`, m: model.metrics.in_area, small: true }
      : { key: "in_area", label: `Earlier model as published, trials in this area only${where}, its own test years`, m: model.metrics.in_area, small: true },
  ];
  const cut = monthYear(cmp.cutoff);
  const pub = cmp.v1_published_auc ?? null;
  const recipe = cmp.v1_recipe.auc;
  return (
    <>
      <div className="rk-m-scroll">
        <table className="rk-m-table">
          <caption>Before and after, on the test trials running in {cut}</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Trials</th>
              <th scope="col">AUC</th>
              <th scope="col">Brier</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <MetricRow key={r.key} row={r} />
            ))}
          </tbody>
        </table>
      </div>
      {pub === null && !cmp.v1_committed ? null : (
      <p className="rk-m-note">
        {pub === null
          ? null
          : recipe !== null && pub > recipe
            ? `The earlier model's published AUC of ${pub.toFixed(3)} was higher because it was measured on each trial's final record, which can carry edits made after the trial ended (sites, countries, arms) that hint at how it ended. Here it reads each record as it stood in ${cut}, as the new model does.`
            : `The earlier model's published AUC of ${pub.toFixed(3)} was measured on each trial's final record; here it reads each record as it stood in ${cut}, as the new model does.`}
        {pub !== null && cmp.v1_committed ? " " : null}
        {cmp.v1_committed
          ? "The subset row is the earlier model exactly as published, scored only on the test trials that started after its own training years, so it covers fewer trials."
          : null}
      </p>
      )}
      {isV2 ? (
        <p className="rk-m-note">
          The area row is the fit trained on trials that had ended by {cut}, scored on this area&apos;s test trials
          only. With a few hundred trials or fewer, changing the random seed alone moves its AUC by several
          hundredths, so it cannot show whether the model does better or worse here than elsewhere.
        </p>
      ) : (
        <p className="rk-m-note">
          The area row is the earlier model&apos;s own evaluation fit, scored on this area&apos;s trials from its own
          test years, not on the trials above; with a few hundred trials or fewer it cannot show whether the model
          does better or worse here than elsewhere.
        </p>
      )}
      <p className="rk-m-note">
        Edit history (how often a trial&apos;s completion date slipped, its planned enrollment was cut or its status
        stepped back over the previous year) is measured for comparison but not used: the daily update sees only each
        trial&apos;s current record, and ClinicalTrials.gov offers no history the site could read, so it could not
        be computed for the trials being scored.
      </p>
    </>
  );
}

const MODEL_LABEL: Record<RiskModelInfo["shipped"], string> = {
  baseline: "baseline model",
  boosted: "boosted-tree model",
};

/** The Methods section. `model` is null while risk.json is missing (the run skipped or failed the stage). */
export function RiskMethods({ model, area }: { model: RiskModelInfo | null; area: string | null }) {
  return (
    <section id="stop-risk" aria-labelledby="stop-risk-h" className="rk-m">
      <h2 id="stop-risk-h" tabIndex={-1}>How good is the stop-risk model?</h2>
      {model && !model.per_trial ? (
        <p>
          Target pages and the Watchlist show, for each target, the median estimated chance that its running drug or
          biologic trials in Phase 1 to 3 will stop early, where at least three are scored. Estimates for single trials
          are not published. It is a statistical estimate from public registry data, not a statement about any sponsor
          or trial, and it is often wrong.
        </p>
      ) : (
        <p>
          Target pages, trial pages and the Watchlist show, for each running drug or biologic trial in Phase 1 to 3, an
          estimated chance that it will stop early. It is a statistical estimate from public registry data, not a
          statement about any sponsor or trial, and it is often wrong.
        </p>
      )}
      {model ? <RiskMethodsBody model={model} area={area} /> : <p>Estimates and their accuracy appear after the next update.</p>}
    </section>
  );
}

function RiskMethodsBody({ model, area }: { model: RiskModelInfo; area: string | null }) {
  const { metrics } = model;
  // The before/after table follows `comparison`; the v2 prose follows the card's feature set. A v1 card without a
  // comparison renders exactly as before; a v1 card with one (v2 did not ship) keeps the v1 prose and adds the table.
  const cmp = model.comparison;
  const v2 = model.feature_set === "v2" ? cmp : undefined;
  const shipped = metrics[model.shipped];
  const testN = shipped.n;
  const rows: Row[] = [
    { key: "baseline", label: "Baseline: phase, sponsor type and start year", m: metrics.baseline },
    { key: "boosted", label: `Boosted trees${model.shipped === "boosted" ? " (shipped)" : ""}`, m: metrics.boosted },
    { key: "boosted_no_sites", label: "Boosted trees without site and country features", m: metrics.boosted_no_sites },
    { key: "in_area", label: `Trials in this area only${area ? ` (${area})` : ""}`, m: metrics.in_area, small: true },
  ];
  if (model.shipped === "baseline") rows[0] = { ...rows[0]!, label: `${rows[0]!.label} (shipped)` };
  const typical = model.typical
    .filter((t) => t.sponsor === "all")
    .sort((a, b) => (a.phase === "all" ? -1 : b.phase === "all" ? 1 : a.phase.localeCompare(b.phase)));

  return (
    <>
      <h3>What it predicts</h3>
      <p>
        Whether a trial ends as <em>terminated</em> (stopped early after it started) rather than <em>completed</em>.
        Withdrawn trials, which stop before enrolling anyone, and suspended trials, which may still resume, are left
        out of training. This is a different question from &ldquo;advanced to next phase&rdquo; above: a trial can
        complete and its drug still go no further, and a trial can stop for reasons unrelated to the drug, such as
        slow enrollment or a business decision.
      </p>
      {v2 ? (
        <p>
          The model learns from interventional trials in Phase 1 to 3 (combined phases such as Phase 1/2 included)
          that test at least one drug or biologic, across every disease in the registry, not only this area. It reads
          each trial as its record stood at quarterly snapshots of the registry, not only as it reads today:{" "}
          {int(v2.train_trials)} trials to train on, seen at {int(v2.train_rows)} snapshots in all. Besides what is
          known when a trial starts (phase, design, masking, arms, sponsor type, collaborators, sites and countries,
          outcome counts, disease categories and the sponsor&apos;s earlier record), it uses what a running
          trial&apos;s record says at the time: planned enrollment, recruitment status, how long it has been
          running, its planned duration, how long ago its primary completion date passed, and how long since the
          record was last updated.
        </p>
      ) : (
      <p>
        The model learns from finished interventional trials in Phase 1 to 3 (combined phases such as Phase 1/2
        included) that test at least one drug or biologic and started in 2008 or later, across every disease in the
        registry, not only this area: {int(model.n_train)} trials to train on. It uses only facts known when a trial
        starts: phase, design, masking, arms, sponsor type, collaborators, planned sites and countries, outcome
        counts, disease categories and start year, plus the sponsor&apos;s earlier record (below).
      </p>
      )}

      <h3>How it is tested</h3>
      {v2 ? (
        <>
          <p>
            The model is trained on trials that had ended by {monthYear(v2.cutoff)}, tested on the ones running
            then: {int(v2.v2.n)} trials, of which {int(v2.v2.positives)} stopped early by{" "}
            {monthYear(v2.outcome_snapshot)}. Each test trial is read as its record stood in{" "}
            {monthYear(v2.cutoff)}, so nothing recorded later reaches its estimate. Left out of the test, because
            they had no clear outcome by {monthYear(v2.outcome_snapshot)}: {exclusionList(v2.test_exclusions)}.
          </p>
          <p>
            One bias is known and accepted. Trials that had ended by {monthYear(v2.cutoff)} over-represent quick
            endings: the young ones that ended so soon mostly stopped early. The earlier and the new model train on
            these same trials and are tested on trials that were all still running, so the comparison stays fair and
            any harm shows in both test scores. The model on the site is refitted on trials that had ended by{" "}
            {monthYear(model.refit_end)}, which has less of this bias, so the published accuracy is, if anything,
            conservative.
          </p>
        </>
      ) : (
      <p>
        The model is trained on trials started up to {year(model.split.train_end)} and tested on trials started from{" "}
        {year(model.split.test[0])} to {year(model.split.test[1])} that have finished: {int(testN)} trials, of which{" "}
        {int(shipped.positives)} stopped early. Testing on later years asks the honest question, how well it does on
        trials it could not have seen. Trials started after {year(model.split.test[1])} are left out of the test:
        many have not finished yet, and those that have are mostly the short ones, which stop early more often, so
        they would make the test look unlike the trials being scored.
      </p>
      )}
      <p>
        AUC is the chance that a randomly chosen trial that stopped early gets a higher estimate than one that
        completed: 0.5 is a coin toss, 1 is perfect. The Brier score is the average squared gap between estimate
        and outcome; lower is better.
      </p>

      {v2 ? null : (
      <>
      <div className="rk-m-scroll">
        <table className="rk-m-table">
          <caption>Accuracy on later trials (test set)</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Trials</th>
              <th scope="col">AUC</th>
              <th scope="col">Brier</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <MetricRow key={r.key} row={r} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="rk-m-note">
        The area row is the evaluation fit (trained on trials started up to {year(model.split.train_end)}) scored on
        this area&apos;s test trials only. With a few hundred
        trials or fewer, changing the random seed alone moves its AUC by several hundredths, so it cannot show
        whether the model does better or worse here than elsewhere.
      </p>
      </>
      )}

      {cmp ? (
        <>
          <h3>Before and after</h3>
          <p>
            {v2
              ? null
              : `A new version of the model (v2) was trained on trials that had ended by ${monthYear(cmp.cutoff)} and tested on the ones running then, read as their records stood at that date; the earlier model's recipe was retrained on the same trials. `}
            Each row is scored on the same {int(cmp.v2.n)} test trials, followed to {monthYear(cmp.outcome_snapshot)},
            except the rows marked otherwise.
          </p>
          <BeforeAfter model={model} cmp={cmp} area={area} />
        </>
      ) : null}

      <h3>Which model is used</h3>
      {v2 ? (
        <p>
          The new model replaces the earlier one only if, on these test trials, its AUC beats the earlier
          model&apos;s by at least 0.02, its Brier score is no worse, and its features come out the same when
          computed from today&apos;s registry as from the snapshots (a parity check). Within the new model, boosted
          trees are used over the baseline on the same 0.02 rule. This time the {MODEL_LABEL[model.shipped]} is
          used: {model.shipped_reason}.{" "}
          {v2.v2_ships
            ? "It passes against the earlier model, so the new model is the one on the site."
            : `It does not pass against the earlier model (${v2.reason}), so the earlier model stays on the site.`}
        </p>
      ) : (
      <p>
        The boosted model is used only if its AUC beats the baseline&apos;s by at least 0.02 and its Brier score is no
        worse; otherwise the baseline is used. This time the {MODEL_LABEL[model.shipped]} is used: {model.shipped_reason}.
      </p>
      )}
      {cmp && !v2 ? (
        <p>
          The new model would replace it only if, on the test trials above, its AUC beat the earlier model&apos;s by at
          least 0.02, its Brier score were no worse, and its features came out the same from today&apos;s registry as
          from the snapshots (a parity check). It does not pass ({cmp.reason}), so the earlier model stays on the
          site.
        </p>
      ) : null}

      <CalibrationChart m={shipped} label={MODEL_LABEL[model.shipped]} />
      <p className="rk-m-note">
        {v2 ? "On the earlier model, calibration" : "Calibration"} (turning the trees&apos; scores into chances) was simplified after a first run to keep the model
        file small; that cost about a hundredth of AUC (0.010, measured on the first 9 November 2026 run).
        Estimates come in steps, because calibration maps scores onto a step curve, so several trials can share the
        same estimate; ties are listed by NCT number.
      </p>

      <h3>What is left out, and why</h3>
      {v2 ? (
        <p>
          Anything that records how a trial ended would let the outcome leak into the estimate. Each trial is read as
          it stood at the snapshot, so later edits cannot reach training, and these fields are left out:
        </p>
      ) : (
      <p>
        Anything recorded after a trial starts would let the outcome leak into the estimate. Enrollment comes first:
        a trial that stops early has enrolled fewer people, so actual enrollment mostly records the stop itself.
      </p>
      )}
      <ul data-list="excluded">
        {excludedFirst(model.excluded).map((x) => (
          <li key={x}>{x.replace(/_/g, " ")}</li>
        ))}
      </ul>
      {v2 ? (
        <p>
          One simplification applies to every trial alike: disease categories are read from the latest
          snapshot&apos;s MeSH terms for every snapshot, for training and test trials the same way.
        </p>
      ) : (
      <p>
        One caveat remains. The registry keeps only each trial&apos;s current record, not the record as it stood on
        the start date, and sponsors edit records after a trial ends (sites, countries, arms). The reported accuracy
        may therefore be slightly flattering.
        {model.site_leak_flag ? (
          <>
            {" "}
            Without the site and country features the AUC falls from {metrics.boosted.auc.toFixed(3)} to{" "}
            {metrics.boosted_no_sites.auc.toFixed(3)}, more than 0.03. Site and country counts may partly record
            what happened after the start (a trial that stops opens fewer sites), so treat them as a possible leak.
          </>
        ) : null}
      </p>
      )}

      <h3>Compared with published models</h3>
      <p>
        Two published models built on ClinicalTrials.gov records report higher AUCs.{" "}
        <a href="https://doi.org/10.1038/s41598-021-82840-x">Elkin and Zhu</a> (&ldquo;Predictive modeling of
        clinical trial terminations using feature engineering and embedding learning&rdquo;, <i>Scientific
        Reports</i>, 2021) report over 0.73 for terminated against completed trials of every kind, observational
        studies included.{" "}
        <a href="https://doi.org/10.1038/s41598-023-27416-7">Kavalci and Hartshorn</a> (&ldquo;Improving clinical
        trial design using interpretable machine learning based prediction of early trial termination&rdquo;,{" "}
        <i>Scientific Reports</i>, 2023) report 0.80, counting withdrawn trials as stopped. Both use features drawn
        from eligibility criteria and report accuracy on a held-out share of their own data (a 20% hold-out and a
        70:30 split);{" "}
        {v2
          ? "ours is measured on trials running on a fixed date and followed to their outcome, which is usually harder"
          : "ours is measured on trials started in later years, which is usually harder"}
        , so the numbers are not directly comparable.
      </p>

      <h3>What we tried: trial text (9 November 2026)</h3>
      <p>
        {v2
          ? "On the earlier model and its split, we tested whether the wording of a trial adds anything."
          : "We tested whether the wording of a trial adds anything, on the same split."} Words from the title,
        eligibility criteria and outcomes (TF-IDF) raised the AUC by 0.017 (to 0.699); sentence embeddings from a
        biomedical language model (PubMedBERT) by 0.012 (0.694); both together by 0.019 (0.701). All fell short of
        the 0.03 gain fixed in advance, so the model uses structured fields only. The leak checks were clean: the
        gain disappears when the text is shuffled between trials, and almost all of it comes from the eligibility
        criteria.
      </p>

      <h3>How to read an estimate</h3>
      <p>
        Every estimate sits beside the typical rate: the share of finished trials of the same phase that stopped
        early (split by industry and non-industry sponsors where that differs by at least five points)
        {typical.length ? (
          <>
            ; across phases{" "}
            {typical.map((t, i) => (
              <span key={t.phase}>
                {i ? ", " : ""}
                {t.phase === "all" ? "all phases" : t.phase} {pct(t.rate)}
              </span>
            ))}
          </>
        ) : null}
        . The range is the spread of 20 refits of the model on resampled training data (their 10th to 90th
        percentile), placed around the estimate; a wide range means the model is unsure. An estimate whose range
        includes the typical rate reads as near typical. The listed factors are the three features that moved that
        trial&apos;s estimate most; each states the trial&apos;s own value, and &ldquo;raises&rdquo; or
        &ldquo;lowers&rdquo; says which way it moved the estimate. Disease categories follow the registry&apos;s own
        filing (MeSH), which can differ from how a clinician would name the disease, so they read &ldquo;Registry
        files it under&rdquo;. A trial still listed as running but already past an actual primary completion date
        (active, not recruiting), or with results posted, is finished in all but name and gets no estimate.
        {v2 ? null : (
          <>
            {" "}
            Start year is never listed as a factor: it shifts the estimate, but a recent trial&apos;s year is read as
            the last year the model was refitted on, so the year shown would not be the trial&apos;s own.
          </>
        )}
      </p>
      <p>
        The sponsor&apos;s history is shown as &ldquo;Sponsor&apos;s earlier trials: k of n stopped early
        (registry)&rdquo;. In training it counts only trials that finished before each{" "}
        {v2 ? "snapshot the trial is read at" : "trial started"}; for running
        trials, the count is as of today, so it can include trials that finished after this one started. A sponsor
        with fewer than 5
        earlier finished trials has too short a record: the model is told so and does not use the rate.
      </p>

      <h3>Retraining</h3>
      {v2 ? (
        <>
          <p>
            The model is retrained by hand, not by the daily update; it was last trained on{" "}
            {longDate(model.trained_on)} (version {model.version}). There are two fits of the same recipe. Every
            accuracy figure on this page comes from the fit trained on trials that had ended by{" "}
            {monthYear(v2.cutoff)}; the estimates on the site come from the same recipe refitted on all trials that
            had ended by {monthYear(model.refit_end)}, so their accuracy is the recipe&apos;s accuracy at{" "}
            {monthYear(v2.cutoff)}, measured on the earlier fit. The model file, a numeric test table without trial
            ids and per-sponsor counts are derived from the registry snapshots; the registry data themselves are not
            republished here.
          </p>
          <Credit model={model} cmp={v2} />
        </>
      ) : (
      <p>
        The model is retrained by hand, not by the daily update; it was last trained on {longDate(model.trained_on)}{" "}
        (version {model.version}). There are two fits of the same recipe. Every accuracy figure on this page comes
        from the fit trained on trials started up to {year(model.split.train_end)}; the estimates on the site come
        from the same recipe refitted on all finished trials started up to {year(model.refit_end)}, so their accuracy is
        the recipe&apos;s accuracy on later years, measured on the earlier fit. Later starts are left out of the refit
        for the same reason they are left out of the test: of the trials started since then, the ones already
        finished are mostly those that stopped early. For trials started after {year(model.refit_end)}, the start
        year is read as {year(model.refit_end)}.
      </p>
      )}
      {cmp && !v2 ? <Credit model={model} cmp={cmp} /> : null}
    </>
  );
}
