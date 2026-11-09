# Approvals: which drugs are approved for which disease

`approvals.csv` says, for each pipeline row (target class) and disease, which drugs are approved. The pipeline figure and the target page read it; the daily run never fetches it.

## What "approved" means

Any drug on the target with the same action and modality, ever approved for the disease by any regulator. A withdrawn drug is kept and labelled (`withdrawn` = 1). Approval is at disease level, not subtype. A row defined by named drugs (no class) is never widened to other drugs on the target.

## The two files

- `approvals.csv` is written by `pipeline/scripts/fetch_approvals.py`. Do not edit it by hand.
- `overrides.csv` is written by hand; the script only reads it. Columns: `action,row_id,disease,drug,regulator,year,withdrawn,source_url,note`.
  - `add` inserts an approval neither source finds, or adds a hand source, regulator, year and link to one it does find. It needs a `source_url`. `withdrawn` = 1 marks the drug withdrawn.
  - `exclude` removes a false automatic hit and survives re-runs.
  - Drug names match without regard to case; `row_id` and `disease` match exactly.

## Re-running

From `pipeline/`, with network access (on this Mac set `SSL_CERT_FILE` as for `map_mechanisms.py`):

    uv run python scripts/fetch_approvals.py

Read the printed review: cells found by one source only, cells where the sources disagree, every hand row (an `exclude` that matched nothing says "(no match)"), and label sentences with a negation nearby ("not indicated", "limitations of use"). Fix a wrong hit with an `exclude` row and a missing approval with an `add` row, then run again.

## Sources and licences

- ChEMBL drug indications at phase 4 (any regulator), and molecule data. CC BY-SA 3.0.
- openFDA drug labels, `indications_and_usage` text (United States only). Public domain.
- Hand rows in `overrides.csv`, each with a source link.

## Release

ChEMBL_37 (2026-05-01); openFDA labels fetched <date>
