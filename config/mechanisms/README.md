# Drug mechanisms

Reference data that maps each experimental drug name (as cleaned by the explorer) to its
mechanism of action, molecular targets and modality. It is keyed by drug, never by
condition, and is committed. The daily run only reads these files; it never calls ChEMBL.

| File | What it is | Who writes it |
|---|---|---|
| `drugs.csv` | One row per drug: `drug,status,chembl_id,modality,mechanism_class,mechanism,action_type,targets`. Multi-valued cells are `;`-joined. `status` is `mapped`, `unmapped`, `not_a_drug` or `manual`. | `pipeline/scripts/map_mechanisms.py` (regenerated; do not hand-edit) |
| `overrides.csv` | Same columns. A row here replaces that drug's `drugs.csv` row entirely. Use it to fix a mapping, add a drug ChEMBL does not know (`manual`), or mark a non-drug (`not_a_drug`). | By hand. **`overrides.csv` is hand-written and always wins.** The script never touches it. |
| `target_labels.csv` | `key,label`: short labels for targets. The key is a ChEMBL target id, a gene symbol, or gene symbols `;`-joined in sorted order (e.g. `S1PR1;S1PR2;S1PR3;S1PR4;S1PR5`). Unlabelled targets fall back to the ChEMBL target name, with a trailing " family" dropped. | By hand |

## How a drug is mapped

1. Exact, casefolded match of the drug name against the ChEMBL `pref_name` or any synonym
   (no fuzzy matching, nothing guessed from name endings; no match → `unmapped`).
2. The parent molecule (salts and prodrugs roll up to it). Mechanisms are fetched for the
   parent **and all its forms** (`parent_molecule_chembl_id`); fingolimod's mechanisms,
   for example, are recorded only on its salts.
3. Each mechanism's target → gene symbols → label (above) → class:
   antibodies and proteins that inhibit, antagonise, bind or act as an agent on a target
   become `anti-<label>`; everything else `<label> <action word>` (e.g.
   `S1P receptor modulator`, `BTK inhibitor`). Modality comes from the parent's
   `molecule_type`.
4. A molecule found but without a usable mechanism stays `unmapped` (it keeps its ChEMBL id
   and modality).

## Re-running

```sh
cd pipeline
uv run python scripts/map_mechanisms.py ../raw/            # newest snapshot in the raw dir
uv run python scripts/map_mechanisms.py <snapshot.jsonl.gz> --only fingolimod,ocrelizumab
```

Options: `--out` (default `config/mechanisms`), `--cache` (default `pipeline/.cache/chembl`,
git-ignored; responses are cached by URL, so a re-run is fast and polite; delete it to pick
up a new ChEMBL release), `--labels`, `--config`, and `--record DIR`, which saves every
response trimmed to the fields used (this is how `pipeline/tests/fixtures/chembl/` was made).
The script prints mapped/unmapped counts, trial-weighted coverage and the 40 most frequent
unmapped drugs; add those to `overrides.csv` or `target_labels.csv` as needed.

On a Mac behind TLS inspection, Python may reject the proxy certificate; export the system
roots and point `SSL_CERT_FILE` at them:
`security find-certificate -a -p /Library/Keychains/System.keychain /System/Library/Keychains/SystemRootCertificates.keychain > /tmp/ca.pem`.

## Source and licence

Data from [ChEMBL](https://www.ebi.ac.uk/chembl/), release **ChEMBL_37** (released
2026-05-01, per `https://www.ebi.ac.uk/chembl/api/data/status.json`), retrieved 2026-11-06.
ChEMBL is licensed under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); `drugs.csv` is derived
from it and shared under the same licence. Cite: Zdrazil B. et al., *The ChEMBL Database
in 2023*, Nucleic Acids Res. 2024;52(D1):D1180–D1192.
