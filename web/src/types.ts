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
}

export interface TrialsIndex {
  generated_for: string;
  trials: TrialSummary[];
}

export type Outcome = "succeeded" | "stopped" | "completed_unknown" | "running" | "unknown";

export interface ExplorerTrial {
  cluster: number | null; // id in ExplorerFile.clusters; null = noise or no clusters
  condition_labels: string[];
  drugs: string[];
  end_estimated: boolean;
  end_year: number | null;
  enrollment: number | null;
  has_results: boolean;
  in_pool: boolean; // a finished trial that could succeed (the statistic's pool)
  lead_sponsor: string | null;
  mechanisms: string[];
  modalities: string[];
  nct_id: string;
  outcome: Outcome;
  phase: string | null; // a phase string, "NA", or null
  start_year: number | null;
  targets: string[];
  succeeded_in: string[]; // condition labels the trial succeeded in (R21), sorted
  title: string;
  treatment_types: string[];
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

export interface ExplorerFile {
  clusters: ExplorerCluster[]; // empty when no clusters were found
  generated_for: string;
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
