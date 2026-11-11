# Repository rulesets

GitHub does not read these files automatically. Import each one once:
**Settings → Rules → Rulesets → New ruleset → Import a ruleset**.

| File | Applies to | Rules |
|---|---|---|
| `default-branch.json` | the default branch (`~DEFAULT_BRANCH`, so it survives a rename to `main`) | no deletion, no force push; changes only through a pull request with resolved conversations; the `pipeline`, `web` and `agent` checks must pass on an up-to-date branch. Zero approvals are required so a solo maintainer can merge their own PR. |
| `data-branch.json` | `data` | no deletion only. **Do not add "block force pushes" here:** `daily.yml` replaces the branch with a fresh orphan commit every day, which is a force push. |

The required check names (`pipeline`, `web`, `agent`) are the job names in `.github/workflows/ci.yml`; a test keeps the two in sync.
