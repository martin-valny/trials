# Sponsor parents

`parents.csv` maps raw lead-sponsor strings (as registered on ClinicalTrials.gov) to the
company a reader knows, so the Pipeline's company lens finds every trial of one company under
one name.

| Column | Meaning |
|---|---|
| `sponsor` | The raw lead-sponsor string. Matched case-insensitively after whitespace is collapsed and trailing punctuation removed (`trialradar.pipeline_figure.io.norm_sponsor`). Two rows that normalise to the same key are an error. |
| `parent` | The display name: Roche, Novartis, Merck KGaA, AstraZeneca, J&J ... |
| `kind` | `industry`, `academic`, `government` or `other`. |

A sponsor not listed here keeps its raw name (legal suffixes trimmed) and takes its kind from
the registry's `sponsor_class`. The pipeline logs a warning listing unlisted industry sponsors
with three or more trials, so this file gets maintained. Edit by hand; the daily run only reads it.
