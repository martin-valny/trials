# Pipeline figure

Hand-kept files that decide which row of the front-door Pipeline figure a trial sits in. The
daily run reads them; it never writes them.

| File | Columns | Meaning |
|---|---|---|
| `rows.csv` | `row_id,label,sub,family,family_order,row_order,classes,drugs,gene,blurb,related` | One row per target class. `row_id` is the URL slug (`/target/<row_id>`). `classes`, `drugs` and `related` are `;`-separated. `classes` are ChEMBL mechanism classes exactly as in the explorer's `drug_index`; `drugs` are canonical drug names that map to the row whatever their class (cladribine shares "DNA inhibitor" with cyclophosphamide). A class or drug may be in only one row; every `related` id must exist. `gene` is the single gene symbol when the row is one gene (it may be empty). Families are ordered by `family_order`, rows within a family by `row_order`. |
| `unrowed.csv` | `class,reason` | Mechanism classes that are deliberately not a row (symptomatic, conditioning chemotherapy, too few). A test requires every class with 3 or more trials since 2012 to be in a row or here, so a new class cannot vanish silently. |
| `background.csv` | `drug,reason` | Drugs that never put a trial in a row when it has another experimental drug (conditioning chemotherapy, premedication, corticosteroids given alongside). If they are all a trial has, they do define its row. |

Related files: `config/sponsors/parents.csv` (company parents) and `config/stop_reasons.csv`
(`pattern,group`: case-insensitive regex, first match wins, so order is priority).

A bad row stops the stage with `<file>:<line>: <problem>`; the run itself continues without a
`pipeline.json` (R19).

## Known comparator cases

Interferon-β, glatiramer and corticosteroids are often a comparator or background therapy.
`background.csv` lists the registry spellings seen on the 2026-11 snapshot, so a trial of a
studied drug against them is placed in the studied drug's row only. Two trials still sit in two
rows because a single intervention string names both drugs; Methods should say they are counted
in each row (and once in the headline totals):

- NCT00168766: "interferon-beta-1a plus methylprednisolone" (Interferon-β and Glucocorticoids)
- NCT00771043: "tysabri and avonex" (α4-integrin and Interferon-β)

Trials whose only experimental drug is a listed background drug still define their row. A trial
of a listed background drug plus a drug that maps to no row has no mark (5 on this snapshot).
