"""Structure checks for the fixture-recording workflow."""

from __future__ import annotations

from typing import Any

import yaml
from conftest import REPO_ROOT


def _workflow() -> dict[Any, Any]:
    text = (REPO_ROOT / ".github" / "workflows" / "record-fixtures.yml").read_text()
    loaded = yaml.safe_load(text)
    assert isinstance(loaded, dict)
    return loaded


def _steps() -> list[dict[str, Any]]:
    return list(_workflow()["jobs"]["record"]["steps"])


def test_trigger_is_dispatch_only() -> None:
    wf = _workflow()
    triggers = wf[True] if True in wf else wf["on"]  # PyYAML parses `on` as boolean True
    assert set(triggers) == {"workflow_dispatch"}


def test_permissions() -> None:
    assert _workflow()["permissions"] == {"contents": "write"}


def test_validates_recorded_fixtures() -> None:
    assert any("pytest -m recorded" in s.get("run", "") for s in _steps())


def test_commit_step_tolerates_no_changes() -> None:
    commit = [s for s in _steps() if "git commit" in s.get("run", "")]
    assert len(commit) == 1
    run = commit[0]["run"]
    assert "git diff --cached --quiet" in run
    assert run.index("git diff --cached --quiet") < run.index("git commit")
