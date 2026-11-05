# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's "Report a vulnerability" (Security tab of this repository) rather than a public issue. Include what you found, how to reproduce it, and the affected file or workflow. I will acknowledge within a few days.

## What is in scope

This project processes only public ClinicalTrials.gov data and publishes static files. It has no user accounts, no server, no database service and no user-submitted data. The realistic risks are supply-chain (dependencies, GitHub Actions) and workflow permissions.

## Practices

- **No secrets in the repository.** The only credential used is the workflow's automatic `GITHUB_TOKEN`; no personal access tokens or third-party API keys exist.
- **Least-privilege tokens.** `ci.yml` and `live-check.yml` run with `contents: read`. `daily.yml` has `contents: write` (data branch, releases), `pages: write` and `id-token: write` (Pages deploy); only its keepalive job additionally gets `actions: write`. `record-fixtures.yml` (manual dispatch only) has `contents: write` to commit recorded test fixtures. Tests assert the permission sets of `daily.yml` and `live-check.yml`.
- **Publishing is gated.** The data branch, release upload and Pages deploy run only when the pipeline reports `status=success`.
- **Dependency scanning.** Dependabot (pip, npm, GitHub Actions; weekly), `pip-audit` and `npm audit --audit-level=high` in CI. Lockfiles (`uv.lock`, `package-lock.json`) are committed and installs are frozen (`uv sync --locked`, `npm ci`).
- **External links** from the web app use `rel="noopener noreferrer"`.
- **Untrusted data.** Registry content is rendered through React (escaped); no raw HTML is injected.
