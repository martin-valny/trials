"""Structure checks for the scheduled workflows (parsed, not executed)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml
from conftest import REPO_ROOT

WORKFLOWS = REPO_ROOT / ".github" / "workflows"


def load(name: str) -> dict[str, Any]:
    doc = yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))
    assert isinstance(doc, dict)
    # PyYAML (YAML 1.1) parses the bare key `on` as boolean True.
    if True in doc:
        doc["on"] = doc.pop(True)
    return doc


def steps(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [s for job in doc["jobs"].values() for s in job["steps"]]


def named(doc: dict[str, Any], name: str) -> dict[str, Any]:
    found = [s for s in steps(doc) if s.get("name") == name]
    assert len(found) == 1, f"expected exactly one step named {name!r}"
    return found[0]


@pytest.fixture(scope="module")
def daily() -> dict[str, Any]:
    return load("daily.yml")


def test_daily_triggers(daily: dict[str, Any]) -> None:
    assert daily["on"]["schedule"][0]["cron"] == "17 7 * * *"
    assert "workflow_dispatch" in daily["on"]


def test_daily_concurrency_never_cancels(daily: dict[str, Any]) -> None:
    assert daily["concurrency"]["group"] == "daily"
    assert daily["concurrency"]["cancel-in-progress"] is False


def test_daily_permissions_are_minimal(daily: dict[str, Any]) -> None:
    assert daily["permissions"] == {"contents": "write", "pages": "write", "id-token": "write"}
    # Only the keepalive job may ask for more, and only actions: write.
    for job_name, job in daily["jobs"].items():
        if "permissions" in job:
            assert job_name == "keepalive"
            assert job["permissions"] == {"actions": "write"}


def test_required_steps_exist(daily: dict[str, Any]) -> None:
    for name in (
        "Run pipeline",
        "Push data branch",
        "Upload raw snapshot",
        "Build site",
        "Deploy Pages",
        "Keepalive",
    ):
        named(daily, name)


def test_publishing_steps_are_gated_on_success(daily: dict[str, Any]) -> None:
    gate = "steps.run.outputs.status == 'success'"
    publishing = [
        named(daily, n)
        for n in (
            "Push data branch",
            "Upload raw snapshot",
            "Build site",
            "Upload Pages artifact",
            "Deploy Pages",
        )
    ]
    publishing.append(
        next(s for s in steps(daily) if str(s.get("uses", "")).startswith("actions/setup-node"))
    )
    for step in publishing:
        assert gate in step.get("if", ""), step.get("name") or step.get("uses")


def test_run_step_can_fail_so_evidence_is_uploaded(daily: dict[str, Any]) -> None:
    run = named(daily, "Run pipeline")
    assert run["id"] == "run"
    assert run["continue-on-error"] is True
    evidence = named(daily, "Upload failure evidence")
    assert evidence["if"].startswith("always()")
    assert "raw/*.failed.*" in evidence["with"]["path"]
    assert evidence["with"]["include-hidden-files"] is True
    final = named(daily, "Fail if the run failed")
    assert "exit 1" in final["run"]


def test_raw_upload_never_matches_failed_or_staged_files(daily: dict[str, Any]) -> None:
    script = named(daily, "Upload raw snapshot")["run"]
    assert "raw/????-??-??.jsonl.gz" in script
    assert "raw/????-??-??.meta.json" in script
    assert "failed" not in script.replace("raw/????", "")
    assert "incoming" not in script
    assert "--clobber" in script


def test_data_branch_is_a_single_force_pushed_orphan(daily: dict[str, Any]) -> None:
    script = named(daily, "Push data branch")["run"]
    assert "--orphan" in script
    assert "git push -f" in script
    assert "HEAD:data" in script


def test_site_build_uses_repo_base_path(daily: dict[str, Any]) -> None:
    build = named(daily, "Build site")
    assert build["env"]["BASE_PATH"] == "/${{ github.event.repository.name }}/"
    assert "npm run build" in build["run"]


def test_keepalive_is_pinned_to_a_tag_and_always_runs(daily: dict[str, Any]) -> None:
    job = daily["jobs"]["keepalive"]
    assert job["if"] == "always()"
    uses = named(daily, "Keepalive")["uses"]
    assert uses.startswith("gautamkrishnar/keepalive-workflow@v")


def test_pipeline_invocation_uses_repo_relative_paths(daily: dict[str, Any]) -> None:
    script = named(daily, "Run pipeline")["run"]
    for flag in ("--config ../config/area.yaml", "--data-dir ../data", "--raw-dir ../raw"):
        assert flag in script
    assert "--site-dir ../web/public/data" in script


def test_live_check_is_weekly_and_runs_live_tests() -> None:
    doc = load("live-check.yml")
    assert doc["on"]["schedule"][0]["cron"].split()[2:] == ["*", "*", "1"]
    assert doc["permissions"] == {"contents": "read"}
    assert any("pytest -m live" in str(s.get("run", "")) for s in steps(doc))


def test_every_workflow_parses() -> None:
    for path in sorted(Path(WORKFLOWS).glob("*.yml")):
        assert isinstance(yaml.safe_load(path.read_text(encoding="utf-8")), dict), path.name


def test_data_branch_is_the_last_publishing_step(daily: dict[str, Any]) -> None:
    order = [s.get("name") for s in daily["jobs"]["update"]["steps"]]
    raw, build, deploy, push = (
        order.index(n)
        for n in ("Upload raw snapshot", "Build site", "Deploy Pages", "Push data branch")
    )
    # Raw snapshot and site first; the data branch (the commit point) after everything else.
    assert raw < build < deploy < push


def test_only_a_missing_data_branch_counts_as_a_first_run(daily: dict[str, Any]) -> None:
    detect = named(daily, "Detect data branch")
    assert detect["id"] == "databranch"
    assert "ls-remote --exit-code --heads origin data" in detect["run"]
    assert "2)" in detect["run"] and "exit " in detect["run"]
    checkout = named(daily, "Checkout data branch")
    assert checkout["if"] == "steps.databranch.outputs.exists == 'true'"
    assert "continue-on-error" not in checkout


def test_release_month_comes_from_the_snapshot_date(daily: dict[str, Any]) -> None:
    script = named(daily, "Upload raw snapshot")["run"]
    assert "date -u" not in script
    assert '"${day:0:7}"' in script


RULESETS = REPO_ROOT / ".github" / "rulesets"


def test_ruleset_required_checks_match_ci_jobs() -> None:
    import json

    ci_jobs = set(load("ci.yml")["jobs"])
    rules = json.loads((RULESETS / "default-branch.json").read_text(encoding="utf-8"))["rules"]
    required = {
        c["context"]
        for r in rules
        if r["type"] == "required_status_checks"
        for c in r["parameters"]["required_status_checks"]
    }
    assert required == ci_jobs


def test_data_branch_ruleset_allows_the_daily_force_push() -> None:
    import json

    rules = json.loads((RULESETS / "data-branch.json").read_text(encoding="utf-8"))["rules"]
    assert {r["type"] for r in rules} == {"deletion"}  # no non_fast_forward: daily.yml force-pushes
    assert "git push -f" in named(load("daily.yml"), "Push data branch")["run"]
