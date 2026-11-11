/** Mirrors the JSON written by pipeline/src/trialradar/export.py exactly. */

export interface DateInfo {
  date: string; // YYYY-MM-DD
  precision: "day" | "month";
  type: "ACTUAL" | "ESTIMATED" | null;
}

export interface ChangeItem {
  nct_id: string;
  title: string | null;
  lead_sponsor: string | null;
  field: string;
  old_value: unknown;
  new_value: unknown;
  detected_date: string;
  delta_days: number | null;
  notable: boolean;
  notable_reason: string | null;
  source_url: string;
}

export interface ChangesFile {
  window_days: 1 | 7 | 30;
  generated_for: string;
  changes: ChangeItem[];
}

export interface TrialFile {
  nct_id: string;
  title: string;
  phases: string[];
  overall_status: string;
  why_stopped: string | null;
  start_date: DateInfo | null;
  primary_completion_date: DateInfo | null;
  completion_date: DateInfo | null;
  enrollment: number | null;
  enrollment_type: string | null;
  lead_sponsor: string | null;
  sponsor_class: string | null;
  conditions: string[];
  interventions: { type: string; name: string }[];
  countries: string[];
  site_count: number;
  primary_outcomes: { measure: string; time_frame: string | null }[];
  secondary_outcomes: { measure: string; time_frame: string | null }[];
  allocation: string | null;
  masking: string | null;
  last_update_post_date: string | null;
  brief_summary: string | null;
  eligibility: {
    sex: "ALL" | "FEMALE" | "MALE" | null;
    min_age_years: number | null;
    max_age_years: number | null;
  };
  has_results: boolean;
  changes: ChangeItem[];
  source_url: string;
}

export interface Meta {
  area: string;
  conditions: string[];
  generated_for: string;
  trial_count: number;
  last_success_at: string | null; // ISO, UTC, trailing Z; null before the first success
  tracking_since: string | null; // YYYY-MM-DD of the first successful run
  data_timestamp: string | null;
  warnings: string[];
}

export type Window = 1 | 7 | 30;

export interface TrialSummary {
  nct_id: string;
  title: string;
  overall_status: string;
  phases: string[];
  lead_sponsor: string | null;
  start_date: DateInfo | null;
  primary_completion_date: DateInfo | null;
  enrollment: number | null;
  last_change: string | null; // YYYY-MM-DD of the latest recorded change
  dz?: string[]; // disease codes in figure order; absent when the trial is in none
}

export interface TrialsIndex {
  generated_for: string;
  trials: TrialSummary[];
}

export type Outcome = "succeeded" | "stopped" | "completed_unknown" | "running" | "unknown";

export interface ExplorerTrial {
  /** Approach keys (ExplorerFile.approaches), sorted; ["unclassified"] when nothing else applies; [] without approach data. */
  approaches: string[];
  cluster: number | null; // id in ExplorerFile.clusters; null = noise or no clusters
  condition_labels: string[];
  drugs: string[];
  end_estimated: boolean;
  end_year: number | null;
  enrollment: number | null;
  has_results: boolean;
  in_pool: boolean; // a finished trial that could succeed (the statistic's pool)
  /** Kind keys (ExplorerFile.kinds) of its no-target and non-drug interventions. */
  kinds: string[];
  lead_sponsor: string | null;
  mechanisms: string[];
  modalities: string[];
  nct_id: string;
  outcome: Outcome;
  phase: string | null; // a phase string, "NA", or null
  start_year: number | null;
  targets: string[];
  succeeded_in: string[]; // condition labels the trial succeeded in (R21), sorted
  /** The drugs that moved on (R21) and made this trial a success, sorted; empty unless it succeeded. */
  succeeded_by: string[];
  title: string;
  treatment_types: string[];
  /** Unmapped drug names and unmatched intervention names (the Unclassified backlog). */
  unsorted: string[];
  x: number;
  y: number;
  z: number;
}

export interface ExplorerStats {
  baseline_mean: number | null;
  baseline_range: [number, number] | null;
  by_condition: { finished: number; label: string; succeeded: number }[];
  lift: number | null;
  n_averaged: number;
  n_pool: number;
  n_short: number;
  n_succeeded: number;
  /** One-sided permutation p-value; null when the statistic was not computed. */
  p_value: number | null;
  success_rate: number | null;
  verdict: "insufficient" | "chance" | "clustered";
}

/** Which naming branch named a cluster's middle part: a mechanism class, an intervention type, or neither. */
export type ClusterKind = "mechanism" | "type" | "mixed";

/** A named HDBSCAN cluster on the map; x/y/z is a member trial (the one nearest the median). */
export interface ExplorerCluster {
  id: number;
  label: string;
  kind: ClusterKind;
  n: number;
  x: number;
  y: number;
  z: number;
}

/** pipeline ClusterConfig, exported as explorer.json method.clusters. */
export interface ExplorerClusterMethod {
  min_cluster_size: number;
  min_samples: number;
  disease_share: number;
  mechanism_share: number;
  mechanism_min_overall: number;
  type_share: number;
  drug_share: number;
}

/** One approach bubble, in the vocabulary's order. */
export interface ApproachInfo {
  key: string;
  label: string;
}

/** A kind without a molecular target (or a type fallback), and where it sits. */
export interface KindInfo {
  approach: string;
  group: string;
  label: string;
  /** One short sentence, shown as "proposed"; empty for type fallbacks. */
  rationale: string;
  source_url: string;
}

/** What a drug name belongs to: the groups a success of that drug is credited to (1b). */
export interface DrugInfo {
  mechanisms: string[];
  modalities: string[];
  kinds: string[];
  approaches: string[];
}

export interface ExplorerFile {
  /** The approach vocabulary in order; empty when the approach config was missing or invalid. */
  approaches: ApproachInfo[];
  clusters: ExplorerCluster[]; // empty when no clusters were found
  /** Every drug or mapping-type name in any trial, with its groups. */
  drug_index: Record<string, DrugInfo>;
  generated_for: string;
  kinds: Record<string, KindInfo>;
  method: {
    algorithm: string;
    dims: number;
    features: string[];
    k: number;
    min_group: number;
    seed: number;
    /** Feature blocks the neighbourhood statistic uses (the layout's, without mechanism). */
    stat_features: string[];
    /** HDBSCAN parameters and naming thresholds for the named clusters (see Methods). */
    clusters: ExplorerClusterMethod;
  };
  stats: ExplorerStats;
  trials: ExplorerTrial[];
}

/** One node of the mechanism graph (mechanisms.json): a drug, a target or a pathway. */
export interface GraphNode {
  /** "drug:<name>", "target:<GENE>", "class:<mechanism class>" or a pathway id (R-HSA-…, GO:…, curated). */
  id: string;
  kind: "drug" | "target" | "pathway";
  label: string;
  /** Pathways only: where the pathway comes from. */
  source?: "reactome" | "go" | "curated";
  /** Pathways only: a top-level pathway (no parent kept). */
  top_level?: boolean;
  /** Curated pathways only: the reference the node rests on. */
  source_url?: string;
  /** Drug nodes only: the ChEMBL molecule id, when the drug has one. */
  chembl_id?: string;
  /** Seeded layout position, normalised to [-1, 1]. */
  x: number;
  y: number;
  /** Drug nodes only: the trials testing the drug. */
  trials?: string[];
  /**
   * Targets and pathways only: the trials reaching the node only through drugs the node cap left out
   * (absent when there are none). The counts below include them, so the cap never biases a share.
   */
  extra_trials?: string[];
  /** Every trial reaching the node, from every mapped drug (drawn or not). */
  n: number;
  /** Pool trials reaching the node. */
  finished: number;
  /** Pool trials whose winning drug reaches the node (1b). */
  succeeded: number;
  stopped: number;
  running: number;
  conditions: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: "acts_on" | "in_pathway" | "parent" | "shares_genes";
  /** acts_on: the drug's action on the target (ChEMBL action type). */
  action?: string;
  /** shares_genes: the overlap between two pathways. */
  weight?: number;
  source_db?: string;
}

/** mechanisms.json: the Targeted drugs bubble's drug -> target -> pathway graph. */
/** A drug the node cap left out of the graph, with the trials that name it. */
export interface DroppedDrug {
  drug: string;
  n: number;
  trials: string[];
}

/** The node cap (``max_nodes`` over all nodes): counts before and after, and the rule's threshold. */
export interface GraphCut {
  drugs: { before: number; after: number };
  targets: { before: number; after: number };
  pathways: { before: number; after: number };
  /** The fewest trials of a kept drug not credited with a success; null when only credited drugs are kept. */
  min_trials: number | null;
  /** True when every drug credited with a success is drawn. */
  all_succeeded: boolean;
  /** The drugs left out, most trials first. */
  dropped: DroppedDrug[];
}

export interface GraphFile {
  generated_for: string;
  reactome_release: string;
  method: { max_nodes: number; pathway_share?: number; overlap_floor: number; overlap_top_k: number; seed: number };
  /** What the node cap left out (absent in files from before the cap). */
  cut?: GraphCut;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// pipeline.json (the pipeline figure, spec 2026-11-08 §6.4). Marks omit default-valued keys.
export type MarkState = "adv" | "run" | "stop" | "fin" | "unk";
export type SponsorKind = "industry" | "academic" | "government" | "other";

export interface PipelineMark {
  /** NCT id. */
  n: string;
  /** Phase column: 1, 2, 3 or 4 (approved use). */
  c: number;
  /** Absent: the trial spans one phase. */
  span?: "1/2" | "2/3";
  s: MarkState;
  y: number | null;
  y2: number | null;
  /** Absent: the end year is not an estimate. */
  est?: boolean;
  /** Disease codes. */
  dz: string[];
  drug: string;
  /** Index into PipelineFile.sponsors. */
  sp: number;
  /** Disease codes where this placement advanced (R21). Absent: none. */
  si?: string[];
  /** Absent: this placement's own drug carried the trial. Else the drug that advanced. */
  via?: string;
}

export interface PipelineApproval {
  /** Approved drug. */
  d: string;
  src: ("chembl" | "fda_label" | "hand")[];
  url: string;
  /** Absent: not withdrawn. */
  wd?: boolean;
  reg?: string;
  y?: number;
}

export interface PipelineRow {
  id: string;
  label: string;
  sub: string;
  family: string;
  order: number;
  gene: string | null;
  blurb?: string;
  related: string[];
  marks: PipelineMark[];
  /** Disease code to approved drugs for that disease. Absent: no approval data for this row. */
  ap?: Record<string, PipelineApproval[]>;
}

export interface PipelineFamily {
  id: string;
  label: string;
  order: number;
}

export interface PipelineSponsor {
  raw: string;
  parent: string;
  kind: SponsorKind;
}

export interface PipelineTrialInfo {
  /** Title, at most 80 characters. */
  t: string;
  /** Registry's why-stopped text (stopped trials only). */
  why?: string | null;
  /** Stop-reason group (stopped trials only). */
  r?: string;
}

export interface PipelineDisease {
  code: string;
  label: string;
}

export interface PipelineUnrowed {
  class: string;
  trials: number;
  reason: string;
}

export interface PipelineFile {
  generated_for: string;
  /** true when approvals.csv was read (even with no lines); absent when missing or bad */
  approvals?: true;
  counts: { trials: number; targeted: number; in_rows: number; targeted_not_rowed: number };
  diseases: PipelineDisease[];
  families: PipelineFamily[];
  rows: PipelineRow[];
  sponsors: PipelineSponsor[];
  trials: Record<string, PipelineTrialInfo>;
  unrowed: PipelineUnrowed[];
}

// ---------------------------------------------------------------- stop-risk (risk.json)

export interface RiskMetrics {
  auc: number;
  brier: number;
  n: number;
  positives: number;
  calibration: { p: number; observed: number; n: number }[];
}

export interface RiskModelInfo {
  version: string;
  trained_on: string;
  shipped: "baseline" | "boosted";
  shipped_reason: string;
  metrics: {
    baseline: RiskMetrics;
    boosted: RiskMetrics;
    boosted_no_sites: RiskMetrics;
    in_area: RiskMetrics | null;
  };
  site_leak_flag: boolean;
  split: { train_end: string; test: [string, string] };
  /** The shipped model is refit on finished trials started up to this date. */
  refit_end: string;
  features: string[];
  excluded: string[];
  typical: { phase: string; sponsor: string; rate: number; n: number }[];
  n_train: number;
  n_test: number;
  per_trial: boolean;
}

export interface RiskFactor {
  dir: "up" | "down";
  label: string;
}

export interface RiskTrial {
  /** Display name: the figure row's drug (registry casing where it is just the registered name), else the first registered drug or biologic. */
  drug?: string;
  p: number;
  lo: number;
  hi: number;
  typical: number;
  /** What the typical rate is taken over, e.g. "phase 2 drug trials". */
  basis: string;
  factors: RiskFactor[];
}

export interface RiskTargetSummary {
  n: number;
  median: number;
  typical: number;
}

export interface RiskFile {
  generated_for: string;
  model: RiskModelInfo;
  not_scored: Record<string, string>;
  /** Absent when the area config turns per-trial estimates off. */
  trials?: Record<string, RiskTrial>;
  /** Per pipeline row id; absent when there is no pipeline figure. */
  targets?: Record<string, { all: RiskTargetSummary; by_disease: Record<string, RiskTargetSummary> }>;
}

// ---- Diligence agent (mirrors agent/src/diligence/types.py) ----

export type DiligenceSection = "landscape" | "track_record" | "literature" | "competition";
export type DiligenceStepKind = "plan" | "tool" | "note" | "write" | "check" | "limit" | "error" | "done";

export interface DiligenceStep {
  n: number;
  kind: DiligenceStepKind;
  text: string;
  tool: string | null;
  ids: string[];
  ms: number;
  tokens_in: number;
  tokens_out: number;
}

export interface DiligenceSentence {
  id: string;
  section: DiligenceSection;
  text: string;
  cites: string[];
}

export interface DiligenceJudgement {
  stance: "favours" | "mixed" | "against";
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

export interface DiligenceMemo {
  sections: DiligenceSentence[];
  read: string[];
  judgement: DiligenceJudgement;
  would_change: string[];
}

export interface DiligenceVerdict {
  sentence_id: string;
  verdict: "supported" | "partly" | "unsupported";
  reason: string;
}

export interface DiligenceRemoved {
  sentence_id: string;
  text: string;
  reason: string;
}

export interface RunRecord {
  run_id: string;
  target: string;
  disease: string;
  fingerprint: string;
  agent_version: string;
  status: "running" | "done" | "failed";
  started_at: string;
  finished_at: string | null;
  steps: DiligenceStep[];
  memo: DiligenceMemo | null;
  verdicts: DiligenceVerdict[];
  removed: DiligenceRemoved[];
  judgement_shown: boolean;
  models: Record<string, unknown>;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  data_date: string;
}
