"""Generate the web app's test data by running the real pipeline end to end.

Two simulated days through ``run`` (so ``export`` produces every file), using the
deterministic integration dataset. The output is committed; never hand-edit it.

    uv run python scripts/make_web_fixtures.py [OUT_DIR]
"""

from __future__ import annotations

import copy
import importlib
import shutil
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

PIPELINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE / "tests"))

from trialradar.config import load_config

ic: Any = importlib.import_module("integration.conftest")

REPO_ROOT = PIPELINE.parent
DEFAULT_OUT = REPO_ROOT / "web" / "tests" / "fixtures" / "data"
D1, D2 = date(2026, 11, 3), date(2026, 11, 4)
TS1, TS2 = "2026-11-03T10:00:00", "2026-11-04T10:00:00"
SECOND_SPONSOR = "Acme Biotech"


def _with_second_sponsor(studies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = copy.deepcopy(studies)
    for s in out:
        if ic.nct(s) == ic.STATUS_EDIT:
            s["protocolSection"]["sponsorCollaboratorsModule"]["leadSponsor"]["name"] = (
                SECOND_SPONSOR
            )
    return out


def main(out_dir: Path) -> None:
    cfg = load_config(REPO_ROOT / "config" / "area.yaml")
    fixtures = PIPELINE / "tests" / "fixtures"
    cfg = cfg.model_copy(
        update={
            "mechanisms_dir": fixtures / "mechanisms",
            "approaches_dir": fixtures / "approaches",
        }
    )
    with tempfile.TemporaryDirectory() as tmp:
        env = ic.Env(Path(tmp), cfg)
        r1 = env.run(ic.FakeClient(TS1, _with_second_sponsor(ic.day1_studies(cfg))), D1)
        r2 = env.run(ic.FakeClient(TS2, _with_second_sponsor(ic.day2_studies(cfg))), D2)
        if (r1.status, r2.status) != ("success", "success"):
            raise SystemExit(f"fixture runs failed: {r1} {r2}")
        if out_dir.exists():
            shutil.rmtree(out_dir)
        shutil.copytree(env.site_dir, out_dir)
    print(f"wrote {out_dir}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT)
