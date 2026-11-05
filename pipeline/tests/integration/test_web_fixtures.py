"""The committed web fixtures must be exactly what the pipeline exports today."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from conftest import REPO_ROOT

from integration.conftest import tree_bytes

SCRIPT = REPO_ROOT / "pipeline" / "scripts" / "make_web_fixtures.py"
COMMITTED = REPO_ROOT / "web" / "tests" / "fixtures" / "data"


def test_committed_web_fixtures_are_current(tmp_path: Path) -> None:
    spec = importlib.util.spec_from_file_location("make_web_fixtures", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    out = tmp_path / "data"
    module.main(out)
    assert tree_bytes(out) == tree_bytes(COMMITTED), (
        "web fixtures are stale; run: cd pipeline && uv run python scripts/make_web_fixtures.py"
    )
