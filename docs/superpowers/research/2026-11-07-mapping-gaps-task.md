# Task: close the mechanism-mapping gaps (research + proposal)

Status: **open**. Created 2026-11-07 (end of session 6). Owner: Martin. This file is self-contained, so a fresh agent can start or resume from it alone. **Update the Progress log at the bottom as you go.** Commit after each step.

## Why

Phase 2 maps each trial's experimental drugs to a mechanism class, targets and modality, using ChEMBL plus hand overrides (`config/mechanisms/`). Coverage is **838 of 1,314 drug-bearing trials (63.8%)**, against a target of 80%.

The rest was left unmapped on purpose, because the project never guesses. It is listed in `docs/superpowers/research/2026-11-06-mechanism-review-sheet.md`:
- **§1:** about 170 trials of decisions, in five groups: glatiramer, IVIG/SCIG, stem cells/aHSCT, drugs ChEMBL lists with no mechanism, vaccines.
- **§1:** three arm-type questions.
- **§2:** 12 suspicious class names, e.g. the fumarates as "KEAP1 inhibitor", interferon beta as "IFN-α/β receptor modulator", cytotoxics as "DNA inhibitor".
- A long tail of 296 names that each appear in only one trial.

Martin's question: **what are these, how should each be mapped, and is ChEMBL the right source, or should it be combined with another?**

## Goal

1. For every item in review-sheet §1 and §2, plus the 60 most frequent unmapped tail names, give:
   - what it is;
   - a proposed mapping (mechanism class, targets as gene symbols, modality from the closed set), or `not_a_drug`, or "leave unmapped";
   - a citable source (URL plus database id) and a confidence level.
2. Evaluate the candidate second sources below. Recommend whether to add one to `map_mechanisms.py` (as a fallback after ChEMBL), or to keep ChEMBL plus hand overrides.
3. Propose a cleaner class vocabulary for the §2 problems, e.g. "agonist" vs "modulator", one class per target family, readable names.

## Candidate sources to evaluate (licence matters: the repo is public and the mapping files are committed)

| Source | Licence (verify) | Why consider |
|---|---|---|
| ChEMBL (current) | CC BY-SA 3.0 | Already used; mechanism records are curated but miss many biologics and newer agents. |
| IUPHAR/BPS Guide to Pharmacology | CC BY-SA 4.0 | Expert-curated targets and actions, including biologics. |
| Open Targets Platform (drug mechanisms) | CC0 | Mostly re-uses ChEMBL; check whether it adds anything. |
| NCATS Inxight Drugs / GSRS | public domain (check) | Mechanism text and targets for investigational and biologic agents. |
| MeSH Pharmacologic Action | public domain | Coarse classes (e.g. "Immunologic Factors"); possibly a modality or class fallback. |
| Wikidata | CC0 | Drug → "physically interacts with" target, plus class; quality varies. |
| openFDA / DailyMed labels | public domain | The label's "mechanism of action" section, for approved drugs. |
| DrugBank | non-commercial / restricted | **Likely ruled out** for a public repo; confirm and say why. |

Use the ChEMBL and Open Targets tools available in the session (MCP `chembl`, `ot`), web search and fetch, and the sources' public APIs. Record every source you actually used.

## Constraints (same as phase 2)

- **No guessing.** Every proposed mapping cites a source that states the mechanism or target. Use "leave unmapped" when sources disagree or say nothing. Literature is fine when cited (PMID or DOI).
- **Modality** is one of: small molecule, antibody, protein, oligonucleotide, cell therapy, gene therapy, other.
- **Do not edit `config/mechanisms/drugs.csv` or `overrides.csv`.** Write proposals to a separate file (below). Martin approves before anything goes into overrides.
- **Never commit trial-level data:** no NCT ids, titles, sponsors or enrollments. Drug names and trial counts are fine.
- **New area = config only:** no condition names in source code. Docs are fine.

## Deliverables (all under `docs/superpowers/research/`)

1. `2026-11-07-mapping-gaps-report.md`:
   - a source comparison table (coverage on our gap list, licence, API, effort);
   - a recommendation;
   - the proposed class vocabulary for the §2 issues;
   - the effect on coverage if Martin accepts everything ("coverage would go from 63.8% to N%"), computed the same way as the review sheet §0, i.e. trial-weighted, all drugs resolved.
2. `2026-11-07-proposed-overrides.csv`:
   - the same columns as `config/mechanisms/overrides.csv` (`drug, status, chembl_id, modality, mechanism_class, mechanism, action_type, targets, source`), plus a `confidence` column (`high`/`medium`/`low`);
   - one row per proposal;
   - drug names lower-case, exactly as in `drugs.csv`.
3. If a second source is recommended: a short design note on how `map_mechanisms.py` would use it (fallback order, how its targets map to gene symbols, caching, recorded test fixtures). This is a proposal only, no code. Implementing it would be its own plan.

## How to resume

Read this file and the review sheet, then continue from the last Progress log entry. Work on branch `research/mapping-gaps`, in worktree `.superpowers/wt/mapping-gaps` if it exists. Commit each step there. Don't push; Martin pushes.

## Progress log

- 2026-11-07: task created. Not started.
- 2026-11-07 (agent, step 1): worktree `.superpowers/wt/mapping-gaps` on `research/mapping-gaps`. Recomputed the gap list from `drugs.csv` + `overrides.csv` and the 2026-11-06 snapshot (scratch script `gaps.py` in the session scratchpad `mapping-gaps/`, imports `trial_drugs` from `map_mechanisms.py`, no network): 838/1,314 = 63.8% confirmed; 414 unmapped names, 71 with >=2 trials (so "top 60" = all names with >=2 trials), 343 with one trial. Scope fixed as: §1 groups (glatiramer, IVIG/SCIG, stem cells/aHSCT, ChEMBL-no-mechanism drugs, vaccines) + 3 arm questions, §2 rows 1-13, and every unmapped name with >=2 trials. Next: probe each candidate source on a fixed sample of ~45 gap drugs; then research per-drug rows into `2026-11-07-proposed-overrides.csv`; then the report.
- 2026-11-07 (agent, step 2): source probes done on a fixed 50-name gap sample (`sample.txt`; scripts `probe_*.py`, outputs `probe_*.out` in the scratchpad `mapping-gaps/`). Results (found / target- or mechanism-level): ChEMBL 0 mech by construction; Open Targets 43 found / 0 mech (pure ChEMBL re-use); GtoPdb 23 / 12 (REST API now needs an API key; bulk CSVs at guidetopharmacology.org/DATA/ download without one, v2026.3.1; licence ODbL + CC BY-SA 4.0); GSRS 45 / 16 TARGET relationships (public domain, US gov); NCIt (EVS REST, CC BY 4.0, not on the brief's list but strong) 36 found / 20 with definitions, parent classes like "Covalent BTK Inhibitor", "Anti-CD20 Monoclonal Antibody"; MeSH PA 24 / 15 class-only; Wikidata 25 / 1; openFDA 11 / 5 MoA sections (mostly "not established"). DrugBank: full data CC BY-NC 4.0 (and downloads paused), open vocabulary CC0 has no targets -> ruled out. Next: per-drug research rows.
