# Drug mechanisms

Reference data that maps each experimental drug name (as cleaned by the explorer) to its
mechanism of action, molecular targets and modality. It is keyed by drug, never by
condition, and is committed. The daily run only reads these files; it never calls ChEMBL.

Drug names are matched lower-case (casefolded) in both CSVs, so `Vitamin D` in
`overrides.csv` replaces the `vitamin d` row. A drug may appear only once per file.

| File | What it is | Who writes it |
|---|---|---|
| `drugs.csv` | One row per drug: `drug,status,chembl_id,modality,mechanism_class,mechanism,action_type,targets`. Multi-valued cells are `;`-joined. `status` is `mapped`, `unmapped`, `not_a_drug` or `manual`. | `pipeline/scripts/map_mechanisms.py` (regenerated; do not hand-edit) |
| `overrides.csv` | Same columns plus an optional `source` column (why the row exists; ignored by the pipeline). A row here replaces that drug's `drugs.csv` row entirely. Use it to fix a mapping, add a drug ChEMBL does not know (`manual`), or mark a non-drug (`not_a_drug`). | By hand. **`overrides.csv` is hand-written and always wins.** The script never touches it. |
| `target_labels.csv` | `key,label`: short labels for targets. The key is a ChEMBL target id, a gene symbol, or gene symbols `;`-joined in sorted order (e.g. `S1PR1;S1PR2;S1PR3;S1PR4;S1PR5`). Unlabelled targets fall back to the ChEMBL target name, with a trailing " family" dropped. | By hand |

Pathway files (phase 3, the mechanism graph):

| File | What it is | Who writes it |
|---|---|---|
| `pathways.json` | `{reactome_release, targets: {gene: [pathway_id]}, pathways: {id: {name, parents, genes, source}}, overlaps: [[id_a, id_b, jaccard]]}`. Each target gene's lowest-level Reactome pathways, all their ancestors, and shared-gene overlaps between kept pathways. | `pipeline/scripts/map_pathways.py` (regenerated; do not hand-edit) |
| `go_fallback.csv` | `target,go_id,go_name`: one Gene Ontology biological-process term for a target with no Reactome pathway, or only an uninformative one. Reviewable; delete a row to drop it. | `map_pathways.py` |
| `curated_pathways.csv` | `target,node_label,note,source_url`: hand-picked links neither source covers well (CD52 → "lymphocyte depletion" for alemtuzumab). A curated row replaces GO and Reactome for that target; its node id is `curated:<slug of node_label>`. `source_url` is required. | By hand. The script never touches it. |

## How a target gets its pathways

1. **Human proteins only.** A target must be the exact symbol of a reviewed (Swiss-Prot)
   human protein in QuickGO. Bacterial and viral targets (`rplA`, influenza `M`) get no
   pathway, even though Reactome's gene sets name a viral `M` protein.
2. **Reactome.** From the GMT gene sets (gene symbols per pathway, every level): the
   lowest-level pathways that list the gene, plus all their ancestors. Excluded with
   everything below them: "Disease" (`R-HSA-1643685`), "Drug ADME" (`R-HSA-9748784`) and the
   drug-action pathways inside normal branches ("Rituximab:MS4A1 targets B cells ...",
   "Drug-mediated inhibition of ..."; the list is `EXCLUDE_ROOTS` in the script), which
   would make the graph circular. Overlaps: the Jaccard index of two kept pathways' gene
   sets, when neither is the other's ancestor, above a floor the script raises until
   `pathways.json` is under 1 MB.
3. **Gene Ontology** (QuickGO) for a target with no Reactome pathway, or only uninformative
   ones (`UNINFORMATIVE` in the script, starting with CD52: only GPI-anchor biosynthesis):
   from its manually reviewed (non-IEA), positive biological-process annotations, the most
   specific term (not an ancestor of another of its terms, then the deepest, then the most
   annotations). GO nodes have no parent and no shared-gene links.
4. **Curated** rows replace both. The graph marks every node and edge with its `source`.

Current state (2026-11-08): Reactome release **98**, 783 pathways kept, 9,902 overlaps at
floor 0.15 (754 KB). Of 464 target symbols, 402 are human proteins: Reactome 387, GO 13,
curated 1 (CD52), none 1 (GPRC5D); 62 are bacterial or viral.

Re-run (needs network; on this Mac set `SSL_CERT_FILE`, see below):

```sh
cd pipeline
uv run python scripts/map_pathways.py      # reads drugs.csv + overrides.csv here
```

Options: `--mappings`, `--out` (both default `config/mechanisms`), `--cache` (default
`pipeline/.cache/reactome`, not committed; the Reactome files are cached per release, the
QuickGO responses by URL), `--max-bytes`, and `--record DIR`, which saves the QuickGO
responses trimmed to the fields used (how `pipeline/tests/fixtures/quickgo/` was made). It
prints the target counts by source and the targets with no pathway.

## How a drug is mapped

1. Exact, casefolded match of the drug name against the ChEMBL `pref_name` or any synonym
   (no fuzzy matching, nothing guessed from name endings; no match → `unmapped`). The
   free-text search is tried first; only if it has no exact match, exact `pref_name` and
   then exact synonym lookups. Exact matches that belong to different parent molecules are
   ambiguous and stay `unmapped` (resolve them in `overrides.csv`).
2. The parent molecule (salts and prodrugs roll up to it). Mechanisms are fetched for the
   parent **and all its forms** (`parent_molecule_chembl_id`); fingolimod's mechanisms,
   for example, are recorded only on its salts.
3. Each mechanism's target → gene symbols → label (above) → class:
   antibodies and proteins that inhibit, antagonise, bind or act as an agent on a target
   become `anti-<label>`; everything else `<label> <action word>` (e.g.
   `S1P receptor modulator`, `BTK inhibitor`); cell therapies become `<label> CAR-T`
   (e.g. `CD19 CAR-T`). Modality comes from the parent's
   `molecule_type`.
4. A molecule found but without a usable mechanism stays `unmapped` (it keeps its ChEMBL id
   and modality).

## Current state

First real run: 2026-11-06 snapshot, ChEMBL_37. 909 distinct drug names; ChEMBL maps 247.

**2026-11-08: the reviewed mapping-gaps proposals are applied.** The high- and
medium-confidence rows of `docs/superpowers/research/2026-11-07-proposed-overrides.csv`
(Martin, 2026-11-08) are in `overrides.csv`, with three changes:

- **Vaccines are `not_a_drug`.** In these trials a vaccine is given to test the immune
  response under a treatment, not as the treatment, so every `vaccine` row and every COVID
  vaccine (BNT162b2, mRNA-1273, Ad26.COV2.S and their variants, including the two names
  ChEMBL maps) is `not_a_drug`, with its reason in `source`.
- **Products without a molecular target carry a kind key** in `mechanism_class` (`msc`,
  `immunoglobulin`, `ahsct`, `atg`, `glatiramer`, `myelin_peptide` and so on), with empty
  `targets`. Kind keys are defined in `config/approaches/kinds.csv`, which places them in
  their approach (Cell & transplant, Antibody & plasma, Tolerisation, Broad
  immunomodulators). They never appear as mechanisms. A combination keeps its molecular
  part (`DNA inhibitor;atg`). The myelin peptides' `MBP` target was removed: MBP is the
  tolerising antigen, not a drug target. MuSK CAAR-T is molecular, with target `MUSK`.
- **Low-confidence rows stay unmapped** (cannabis products, helminths, NeuroVax and a few
  codes).

`overrides.csv` now holds 447 rows: 355 `manual` and 92 `not_a_drug`. Every drug resolved for **1,112 of 1,314 drug-bearing trials (84.6%)**,
up from 838 (63.8%); `not_a_drug` counts as resolved. Open questions:
`docs/superpowers/research/2026-11-06-mechanism-review-sheet.md` and the mapping-gaps
report (`docs/superpowers/research/2026-11-07-mapping-gaps-report.md`).

A drug row with a molecular class but no gene target (cladribine `DNA inhibitor`,
cemdisiran `Complement C5 mRNA silencer`) is still molecular and goes to Targeted drugs;
only kind keys leave it. See `config/approaches/README.md`.

## Re-running

```sh
cd pipeline
uv run python scripts/map_mechanisms.py ../raw/            # newest snapshot in the raw dir
uv run python scripts/map_mechanisms.py <snapshot.jsonl.gz> --only fingolimod,ocrelizumab
```

`--only` re-maps just the names given (also names not in the snapshot) and merges them into
the existing `drugs.csv`: those rows are replaced or added, every other row is kept, and the
file is written sorted.

Options: `--out` (default `config/mechanisms`), `--cache` (default `pipeline/.cache/chembl`,
git-ignored; responses are cached by URL, so a re-run is fast and polite; delete it to pick
up a new ChEMBL release), `--labels`, `--config`, and `--record DIR`, which saves every
response trimmed to the fields used (this is how `pipeline/tests/fixtures/chembl/` was made).
The script prints mapped/unmapped drug counts, then coverage by trial with `overrides.csv`
applied: drug-bearing trials whose every drug is `mapped`, `manual` or `not_a_drug` (the
method behind the published 63.8%), and the 40 most frequent unmapped drugs; add those to
`overrides.csv` or `target_labels.csv` as needed.

On a Mac behind TLS inspection, Python may reject the proxy certificate; export the system
roots and point `SSL_CERT_FILE` at them:
`security find-certificate -a -p /Library/Keychains/System.keychain /System/Library/Keychains/SystemRootCertificates.keychain > /tmp/ca.pem`.

## Source and licence

Pathways: [Reactome](https://reactome.org/) release **98** (per
`https://reactome.org/ContentService/data/database/version`), downloaded 2026-11-08 from
`https://reactome.org/download/current/`, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); `pathways.json` is derived from
it. Cite: Milacic M. et al., *The Reactome Pathway Knowledgebase 2024*, Nucleic Acids Res.
2024;52(D1):D672–D678. Gene Ontology terms and annotations via
[QuickGO](https://www.ebi.ac.uk/QuickGO/), retrieved 2026-11-08; GO is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (`go_fallback.csv`). Cite: The
Gene Ontology Consortium, *The Gene Ontology knowledgebase in 2023*, Genetics
2023;224(1):iyad031. `curated_pathways.csv` is hand-written; each row names its source.

Drug mechanisms:

Data from [ChEMBL](https://www.ebi.ac.uk/chembl/), release **ChEMBL_37** (released
2026-05-01, per `https://www.ebi.ac.uk/chembl/api/data/status.json`), retrieved 2026-11-06.
ChEMBL is licensed under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); `drugs.csv` is derived
from it and shared under the same licence. Cite: Zdrazil B. et al., *The ChEMBL Database
in 2023*, Nucleic Acids Res. 2024;52(D1):D1180–D1192.
