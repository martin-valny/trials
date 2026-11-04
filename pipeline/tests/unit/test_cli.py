from __future__ import annotations

import copy
from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest
from conftest import DELETE, REPO_ROOT, make_study

from trialradar import cli
from trialradar.config import AreaConfig
from trialradar.pipeline import RunResult
from trialradar.store import Store

CONFIG = REPO_ROOT / "config" / "area.yaml"


class Fake:
    def __init__(self, timestamp: str, studies: list[dict[str, Any]]) -> None:
        self.timestamp, self.studies = timestamp, studies

    def data_timestamp(self) -> str:
        return self.timestamp

    def iter_studies(self, cfg: AreaConfig) -> Iterator[dict[str, Any]]:
        yield from copy.deepcopy(self.studies)


def studies() -> list[dict[str, Any]]:
    return [make_study(f"NCT9100000{i}") for i in range(1, 6)]


@pytest.fixture
def dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    out = tmp_path / "github_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    return {
        "out": out,
        "data": tmp_path / "data",
        "raw": tmp_path / "raw",
        "site": tmp_path / "site",
    }


def argv(d: dict[str, Path], *extra: str, command: str = "run") -> list[str]:
    args = [command, "--config", str(CONFIG), "--data-dir", str(d["data"])]
    args += ["--raw-dir", str(d["raw"]), "--site-dir", str(d["site"])]
    return [*args, *extra]


def use_client(monkeypatch: pytest.MonkeyPatch, client: Fake) -> None:
    monkeypatch.setattr(cli, "CtGovClient", lambda: client)


def test_run_success_then_skipped(
    dirs: dict[str, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    use_client(monkeypatch, Fake("ts-1", studies()))
    assert cli.main(argv(dirs, "--date", "2026-03-01")) == 0
    assert dirs["out"].read_text() == "status=success\n"
    assert (dirs["site"] / "meta.json").exists()
    assert (dirs["raw"] / "2026-03-01.jsonl.gz").exists()
    assert "success" in capsys.readouterr().out

    assert cli.main(argv(dirs, "--date", "2026-03-02")) == 0
    assert dirs["out"].read_text() == "status=success\nstatus=skipped\n"


def test_run_failed_exits_1(dirs: dict[str, Path], monkeypatch: pytest.MonkeyPatch) -> None:
    bad = studies()
    bad[0] = make_study("NCT91000001", **{"identificationModule.briefTitle": DELETE})
    use_client(monkeypatch, Fake("ts-1", bad))
    assert cli.main(argv(dirs, "--date", "2026-03-01")) == 1
    assert dirs["out"].read_text() == "status=failed\n"
    assert Store(dirs["data"]).run_log()["status"].to_list() == ["failed"]


def test_unexpected_exception_exits_1_and_reports_failed(
    dirs: dict[str, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def boom(*args: Any, **kwargs: Any) -> RunResult:
        raise RuntimeError("kaboom")

    monkeypatch.setattr(cli, "run", boom)
    assert cli.main(argv(dirs)) == 1
    assert dirs["out"].read_text() == "status=failed\n"
    err = capsys.readouterr().err.strip().splitlines()
    assert err == ["trialradar: error: RuntimeError: kaboom"]


@pytest.mark.parametrize(
    "extra",
    [["--date", "2026-02-30"], ["--config", "/nonexistent/area.yaml"]],
    ids=["bad-date", "missing-config"],
)
def test_bad_input_exits_1_with_failed_status(dirs: dict[str, Path], extra: list[str]) -> None:
    assert cli.main([*argv(dirs), *extra]) == 1
    assert dirs["out"].read_text() == "status=failed\n"


def test_run_without_github_output(dirs: dict[str, Path], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GITHUB_OUTPUT")
    use_client(monkeypatch, Fake("ts-1", studies()))
    assert cli.main(argv(dirs, "--date", "2026-03-01")) == 0
    assert not dirs["out"].exists()


def test_run_passes_flags_and_defaults(
    dirs: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, Any] = {}

    def fake_run(
        cfg: AreaConfig, client: Any, store: Store, raw: Path, site: Path, day: date, **kw: Any
    ) -> RunResult:
        seen.update(cfg=cfg, store=store, raw=raw, site=site, day=day, **kw)
        return RunResult("success", 0, [], [])

    monkeypatch.setattr(cli, "run", fake_run)
    use_client(monkeypatch, Fake("ts", []))
    assert cli.main(argv(dirs)) == 0
    assert seen["day"] == datetime.now(UTC).date()
    assert seen["force"] is False and seen["accept_drop"] is False
    assert seen["aliases_dir"] == seen["cfg"].aliases_dir
    assert seen["store"].root == dirs["data"]
    assert (seen["raw"], seen["site"]) == (dirs["raw"], dirs["site"])

    aliases = dirs["data"].parent / "aliases"
    args = argv(dirs, "--force", "--accept-drop", "--aliases-dir", str(aliases))
    assert cli.main([*args, "--date", "2026-01-05"]) == 0
    assert seen["force"] is True and seen["accept_drop"] is True
    assert seen["aliases_dir"] == aliases
    assert seen["day"] == date(2026, 1, 5)


def test_default_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    args = cli.build_parser().parse_args(["run"])
    assert args.config == Path("config/area.yaml")
    assert args.data_dir == Path("data")
    assert args.raw_dir == Path("raw")
    assert args.site_dir == Path("web/public/data")
    assert args.date is None and args.aliases_dir is None


def test_check_prints_ok(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["check", "--config", str(CONFIG)]) == 0
    assert capsys.readouterr().out.strip() == "OK"


def test_check_bad_config_exits_1(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    bad = tmp_path / "area.yaml"
    bad.write_text("name: x\n")
    assert cli.main(["check", "--config", str(bad)]) == 1
    assert capsys.readouterr().err.startswith("trialradar: error: ConfigError")


def test_rebuild_command(dirs: dict[str, Path], monkeypatch: pytest.MonkeyPatch) -> None:
    use_client(monkeypatch, Fake("ts-1", studies()))
    assert cli.main(argv(dirs, "--date", "2026-03-01")) == 0
    snaps = Store(dirs["data"]).snapshots()
    (dirs["data"] / "current" / "trial.parquet").write_bytes(b"corrupt")

    assert cli.main(argv(dirs, command="rebuild")) == 0

    assert Store(dirs["data"]).snapshots().equals(snaps)
    assert Store(dirs["data"]).state_before(date(2026, 3, 2)) is not None


def test_rebuild_error_exits_1(
    dirs: dict[str, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def boom(*args: Any, **kwargs: Any) -> None:
        raise OSError("read-only")

    monkeypatch.setattr(cli, "rebuild", boom)
    assert cli.main(argv(dirs, command="rebuild")) == 1
    assert "OSError: read-only" in capsys.readouterr().err


def test_no_command_is_a_usage_error() -> None:
    with pytest.raises(SystemExit) as exc:
        cli.main([])
    assert exc.value.code == 2
