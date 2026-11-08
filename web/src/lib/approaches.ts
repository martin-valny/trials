import type { DrugInfo, ExplorerFile, ExplorerTrial, Outcome } from "../types";
import { APPROACH_SERIES, NONDRUG, OUTCOMES, UNCLASSIFIED, wonIn } from "./explorer";
import { drugNodeId } from "./graph";

/** The seven approach keys, in the vocabulary's order (the URL's /mechanisms/:approach). */
export const APPROACH_KEYS: readonly string[] = [...APPROACH_SERIES, UNCLASSIFIED];

export const isApproachKey = (key: string | undefined): key is string =>
  key !== undefined && APPROACH_KEYS.includes(key);

export { NONDRUG };

/** The Unclassified group whose rows are the unsorted names (the mapping backlog). */
export const NOT_YET_SORTED = "Not yet sorted";

/**
 * The last Unclassified group: unsorted names carried only by trials in other approaches (an unmapped
 * drug beside a mapped one, say). The trials are not in Unclassified; the names are still backlog.
 */
export const NOT_YET_SORTED_ELSEWHERE = "Not yet sorted, in trials of other approaches";

/**
 * The Unclassified group (and its one row) for trials with neither a kind nor an unsorted name: no
 * experimental treatment survived extraction (placebo, usual care or no experimental arm).
 */
export const NO_INTERVENTION = "No experimental treatment listed";
export const NO_INTERVENTION_ROW = "no experimental treatment kept";

/** One rail row: an approach, its trials, and its success share among pool trials (1b). */
export interface RailRow {
  key: string;
  label: string;
  n: number;
  finished: number;
  succeeded: number;
  /** null under minGroup, and always for Non-drug care. */
  rate: number | null;
  /** false for Non-drug care: success here means a drug moved to a later phase. */
  successDefined: boolean;
}

const rateOf = (finished: number, succeeded: number, minGroup: number): number | null =>
  finished > 0 && finished >= minGroup ? succeeded / finished : null;

/**
 * Every approach in the file's vocabulary, in order, with the trials in it (each once), its finished
 * pool trials and those that succeeded through a drug of this approach (1b). Empty when the file has
 * no approach vocabulary (built without the approach config).
 */
export function railRows(trials: ExplorerTrial[], f: ExplorerFile, minGroup: number): RailRow[] {
  return f.approaches.map(({ key, label }) => {
    let n = 0;
    let finished = 0;
    let succeeded = 0;
    for (const t of trials) {
      if (!t.approaches.includes(key)) continue;
      n += 1;
      if (!t.in_pool) continue;
      finished += 1;
      if (wonIn(t, "approach", key, f.drug_index)) succeeded += 1;
    }
    const successDefined = key !== NONDRUG;
    return {
      key,
      label,
      n,
      finished,
      succeeded,
      rate: successDefined ? rateOf(finished, succeeded, minGroup) : null,
      successDefined,
    };
  });
}

/** One kind row in a tree: its trials by outcome and its pool share (1b). */
export interface TreeKind {
  key: string;
  label: string;
  n: number;
  /**
   * Trials by outcome, 1b: ``succeeded`` counts only wins credited to this kind. A succeeded trial whose
   * win belongs to another drug is in ``elsewhere`` instead; in Non-drug care (success not defined) it
   * counts as completed.
   */
  outcomes: Record<Outcome, number>;
  /** Succeeded trials whose win is credited to a drug outside this kind ("succeeded via another drug"). */
  elsewhere: number;
  /** Their NCT ids, sorted. */
  elsewhereTrials: string[];
  finished: number;
  succeeded: number;
  rate: number | null;
  /** NCT ids, sorted. */
  trials: string[];
}

export interface TreeGroup {
  group: string;
  /** The rationale every kind in the group shares; null when they differ or have none. */
  rationale: string | null;
  source_url: string | null;
  kinds: TreeKind[];
}

/** The prefix of an unsorted-name row's key in the Unclassified tree (kind keys never start with it). */
export const UNSORTED_ROW_PREFIX = "unsorted:";

/** The key of an unsorted-name row in the Unclassified tree. */
export const unsortedKey = (name: string): string => `${UNSORTED_ROW_PREFIX}${name}`;

const zeroOutcomes = (): Record<Outcome, number> =>
  Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;

/**
 * True when a succeeded trial's win belongs to ``kind`` (1b): a drug in its succeeded_by sorts into
 * that kind. A file from before succeeded_by credits the trial's own outcome.
 */
function wonKind(t: ExplorerTrial, kind: string, drugIndex: Record<string, DrugInfo>): boolean {
  if (t.outcome !== "succeeded") return false;
  if (t.succeeded_by.length === 0) return t.kinds.includes(kind);
  return t.succeeded_by.some((d) => drugIndex[d]?.kinds.includes(kind) ?? false);
}

interface Acc {
  key: string;
  label: string;
  group: string;
  members: ExplorerTrial[];
  won: (t: ExplorerTrial) => boolean;
}

function toKind(a: Acc, minGroup: number, successDefined: boolean): TreeKind {
  const outcomes = zeroOutcomes();
  const elsewhere: string[] = [];
  let finished = 0;
  let succeeded = 0;
  for (const t of a.members) {
    const won = successDefined && a.won(t);
    if (t.outcome !== "succeeded" || won) outcomes[t.outcome] += 1;
    else if (successDefined) elsewhere.push(t.nct_id);
    else outcomes.completed_unknown += 1;
    if (!t.in_pool) continue;
    finished += 1;
    if (won) succeeded += 1;
  }
  return {
    key: a.key,
    label: a.label,
    n: a.members.length,
    outcomes,
    elsewhere: elsewhere.length,
    elsewhereTrials: elsewhere.sort(),
    finished,
    succeeded,
    rate: rateOf(finished, succeeded, minGroup),
    trials: a.members.map((t) => t.nct_id).sort(),
  };
}

const byCount = (a: { n: number; label: string }, b: { n: number; label: string }) =>
  b.n - a.n || a.label.localeCompare(b.label);

/**
 * The tree for an approach without a molecular target: group -> kind -> trials, from the file's kinds
 * and each trial's kinds. Groups and kinds run by trial count (most first). In Unclassified the
 * "Not yet sorted" group lists the trials' unsorted names instead of the type fallbacks, so the
 * mapping backlog reads by name; a trial with neither is listed as "No experimental treatment listed".
 * Names carried only by trials in other approaches follow in a last group of their own
 * (NOT_YET_SORTED_ELSEWHERE), so every unsorted name is listed somewhere.
 * Success is credited to the drug that moved on (1b), in the row counts as in the share; under minGroup
 * there is no rate, and Non-drug care never shows a success.
 */
export function kindTree(approach: string, trials: ExplorerTrial[], f: ExplorerFile, minGroup: number): TreeGroup[] {
  const accs = new Map<string, Acc>();
  const add = (key: string, label: string, group: string, t: ExplorerTrial, won: Acc["won"]) => {
    const a = accs.get(key) ?? { key, label, group, members: [], won };
    a.members.push(t);
    accs.set(key, a);
  };
  const unclassified = approach === UNCLASSIFIED;
  for (const t of trials) {
    if (!t.approaches.includes(approach)) continue;
    let placed = false;
    for (const k of t.kinds) {
      const info = f.kinds[k];
      if (info === undefined || info.approach !== approach) continue;
      if (unclassified && info.group === NOT_YET_SORTED) continue; // listed by name below
      add(k, info.label, info.group, t, (x) => wonKind(x, k, f.drug_index));
      placed = true;
    }
    if (!unclassified) continue;
    for (const name of t.unsorted) {
      add(
        unsortedKey(name),
        name,
        NOT_YET_SORTED,
        t,
        (x) => x.outcome === "succeeded" && x.succeeded_by.includes(name),
      );
      placed = true;
    }
    if (!placed) add(unsortedKey(""), NO_INTERVENTION_ROW, NO_INTERVENTION, t, () => false);
  }
  if (unclassified) {
    // Names no Unclassified trial carries: the rest of the backlog, with the trials (elsewhere) that hold them.
    const listed = new Set([...accs.keys()]);
    for (const t of trials) {
      if (t.approaches.includes(UNCLASSIFIED)) continue;
      for (const name of new Set(t.unsorted)) {
        const key = unsortedKey(name);
        if (listed.has(key)) continue;
        add(key, name, NOT_YET_SORTED_ELSEWHERE, t, (x) => x.outcome === "succeeded" && x.succeeded_by.includes(name));
      }
    }
  }
  const successDefined = approach !== NONDRUG;

  const groups = new Map<string, { kinds: TreeKind[]; trials: Set<string> }>();
  for (const a of accs.values()) {
    const g = groups.get(a.group) ?? { kinds: [], trials: new Set<string>() };
    g.kinds.push(toKind(a, minGroup, successDefined));
    a.members.forEach((t) => g.trials.add(t.nct_id));
    groups.set(a.group, g);
  }
  return [...groups]
    .map(([group, g]) => {
      const kinds = g.kinds.sort(byCount);
      const infos = kinds.map((k) => f.kinds[k.key]).filter((x) => x !== undefined);
      const shared =
        infos.length === kinds.length && infos.every((i) => i.rationale !== "" && i.rationale === infos[0].rationale)
          ? infos[0]
          : null;
      return {
        group,
        n: g.trials.size,
        label: group,
        rationale: shared?.rationale ?? null,
        source_url: shared ? shared.source_url || null : null,
        kinds,
      };
    })
    .sort((a, b) => Number(a.group === NOT_YET_SORTED_ELSEWHERE) - Number(b.group === NOT_YET_SORTED_ELSEWHERE) || byCount(a, b))
    .map(({ group, rationale, source_url, kinds }) => ({ group, rationale, source_url, kinds }));
}

/**
 * Where panel d's "Show in mechanism graph" leads: the trial's first approach (Targeted drugs when it
 * has a molecular class). On Targeted drugs it focuses the trial's first targeted drug in the graph
 * (``?node=drug:<name>``); elsewhere it opens the trial's kind there. Null without approaches.
 */
export function mechanismsLink(
  t: ExplorerTrial,
  f: Pick<ExplorerFile, "kinds"> & Partial<Pick<ExplorerFile, "drug_index">>,
): string | null {
  const approach = t.approaches[0];
  if (approach === undefined) return null;
  if (approach === "targeted") {
    const drug = t.drugs.find((d) => f.drug_index?.[d]?.approaches.includes("targeted"));
    return drug === undefined
      ? "/mechanisms/targeted"
      : `/mechanisms/targeted?${new URLSearchParams({ node: drugNodeId(drug) }).toString()}`;
  }
  const kind = t.kinds.find((k) => f.kinds[k]?.approach === approach);
  return kind === undefined ? `/mechanisms/${approach}` : `/mechanisms/${approach}?kind=${encodeURIComponent(kind)}`;
}
