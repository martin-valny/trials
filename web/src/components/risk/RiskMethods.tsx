// Methods, "How good is the stop-risk model?" (spec 6.4, 7). Every figure comes from risk.json's model block;
// the only fixed numbers are the recipe's own rules and the dated notes on the text experiment and calibration.
import { useId } from "react";
import type { RiskMetrics, RiskModelInfo } from "../../types";
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
  m: RiskMetrics | null;
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
      <td>{m.auc.toFixed(3)}</td>
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

const MODEL_LABEL: Record<RiskModelInfo["shipped"], string> = {
  baseline: "baseline model",
  boosted: "boosted-tree model",
};

/** The Methods section. `model` is null while risk.json is missing (the run skipped or failed the stage). */
export function RiskMethods({ model, area }: { model: RiskModelInfo | null; area: string | null }) {
  return (
    <section id="stop-risk" aria-labelledby="stop-risk-h" className="rk-m">
      <h2 id="stop-risk-h">How good is the stop-risk model?</h2>
      <p>
        Target pages, trial pages and the Watchlist show, for each running drug or biologic trial in Phase 1 to 3, an
        estimated chance that it will stop early. It is a statistical estimate from public registry data, not a
        statement about any sponsor or trial, and it is often wrong.
      </p>
      {model ? <RiskMethodsBody model={model} area={area} /> : <p>Estimates and their accuracy appear after the next update.</p>}
    </section>
  );
}

function RiskMethodsBody({ model, area }: { model: RiskModelInfo; area: string | null }) {
  const { metrics } = model;
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
      <p>
        The model learns from finished interventional trials in Phase 1 to 3 (combined phases such as Phase 1/2
        included) that test at least one drug or biologic and started in 2008 or later, across every disease in the
        registry, not only this area: {int(model.n_train)} trials to train on. It uses only facts known when a trial
        starts: phase, design, masking, arms, sponsor type, collaborators, planned sites and countries, outcome
        counts, disease categories and start year, plus the sponsor&apos;s earlier record (below).
      </p>

      <h3>How it is tested</h3>
      <p>
        The model is trained on trials started up to {year(model.split.train_end)} and tested on trials started from{" "}
        {year(model.split.test[0])} to {year(model.split.test[1])} that have finished: {int(testN)} trials, of which{" "}
        {int(shipped.positives)} stopped early. Testing on later years asks the honest question, how well it does on
        trials it could not have seen. Trials started after {year(model.split.test[1])} are left out of the test:
        many have not finished yet, and those that have are mostly the short ones, which stop early more often, so
        they would make the test look unlike the trials being scored.
      </p>
      <p>
        AUC is the chance that a randomly chosen trial that stopped early gets a higher estimate than one that
        completed: 0.5 is a coin toss, 1 is perfect. The Brier score is the average squared gap between estimate
        and outcome; lower is better.
      </p>

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
        The area row is the same shipped model scored on this area&apos;s test trials only. With a few hundred
        trials or fewer, changing the random seed alone moves its AUC by several hundredths, so it cannot show
        whether the model does better or worse here than elsewhere.
      </p>

      <h3>Which model is used</h3>
      <p>
        The boosted model is used only if its AUC beats the baseline&apos;s by at least 0.02 and its Brier score is no
        worse; otherwise the baseline is used. This time the {MODEL_LABEL[model.shipped]} is used: {model.shipped_reason}.
      </p>

      <CalibrationChart m={shipped} label={MODEL_LABEL[model.shipped]} />
      <p className="rk-m-note">
        Calibration (turning the trees&apos; scores into chances) was simplified after a first run to keep the model
        file small; that cost about a hundredth of AUC (0.692 to 0.682 on the 9 November 2026 run).
      </p>

      <h3>What is left out, and why</h3>
      <p>
        Anything recorded after a trial starts would let the outcome leak into the estimate. Enrollment comes first:
        a trial that stops early has enrolled fewer people, so actual enrollment mostly records the stop itself.
      </p>
      <ul data-list="excluded">
        {excludedFirst(model.excluded).map((x) => (
          <li key={x}>{x.replace(/_/g, " ")}</li>
        ))}
      </ul>
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
        70:30 split); ours is measured on trials started in later years, which is usually harder, so the numbers
        are not directly comparable.
      </p>

      <h3>What we tried: trial text (9 November 2026)</h3>
      <p>
        We tested whether the wording of a trial adds anything, on the same split. Words from the title,
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
        . The range is the 10th to 90th percentile of the estimate over 20 refits of the model on resampled
        training data; a wide range means the model is unsure. An estimate whose range includes the typical rate
        reads as near typical. The listed factors are the three features that moved that trial&apos;s estimate most.
        Start year is never listed as a factor: it shifts the estimate, but a recent trial&apos;s year is read as the
        last year the model was refitted on, so the year shown would not be the trial&apos;s own.
      </p>
      <p>
        The sponsor&apos;s history is shown as &ldquo;Sponsor&apos;s earlier trials: k of n stopped early
        (registry)&rdquo;, counting only trials that finished before this one started. A sponsor with fewer than 5
        earlier finished trials has too short a record: the model is told so and uses the average stop rate
        instead.
      </p>

      <h3>Retraining</h3>
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
    </>
  );
}
