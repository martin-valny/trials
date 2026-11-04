"""Command-line entry points: ``trialradar run | check | rebuild``."""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Sequence
from datetime import UTC, date, datetime
from pathlib import Path

from trialradar.config import AreaConfig, load_config
from trialradar.ctgov.client import CtGovClient
from trialradar.pipeline import rebuild, run
from trialradar.store import Store


def _add_dirs(p: argparse.ArgumentParser) -> None:
    p.add_argument("--data-dir", type=Path, default=Path("data"), help="Parquet store root")
    p.add_argument("--raw-dir", type=Path, default=Path("raw"), help="raw snapshot directory")
    p.add_argument(
        "--site-dir", type=Path, default=Path("web/public/data"), help="site JSON output"
    )
    p.add_argument(
        "--aliases-dir", type=Path, default=None, help="alias CSVs (default: from config)"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="trialradar")
    sub = parser.add_subparsers(dest="command", required=True)
    commands = {
        "run": "fetch, check, diff, store and export one day",
        "check": "validate the config and print OK",
        "rebuild": "regenerate the store and site from raw snapshots",
    }
    for name, help_text in commands.items():
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--config", type=Path, default=Path("config/area.yaml"))
        if name == "check":
            continue
        _add_dirs(p)
        if name == "run":
            p.add_argument("--date", default=None, help="YYYY-MM-DD (default: today UTC)")
            p.add_argument("--force", action="store_true", help="run even if data is unchanged")
            p.add_argument(
                "--accept-drop",
                action="store_true",
                help="accept a large drop in trial count (demotes row_drop_error to a warning)",
            )
    return parser


def _error(exc: BaseException) -> None:
    print(f"trialradar: error: {type(exc).__name__}: {exc}", file=sys.stderr)


def _aliases(args: argparse.Namespace, cfg: AreaConfig) -> Path:
    return args.aliases_dir if args.aliases_dir is not None else cfg.aliases_dir


def _github_output(status: str) -> bool:
    target = os.environ.get("GITHUB_OUTPUT")
    if not target:
        return True
    try:
        with open(target, "a", encoding="utf-8") as f:
            f.write(f"status={status}\n")
    except OSError as exc:
        _error(exc)
        return False
    return True


def _run(args: argparse.Namespace) -> int:
    status = "failed"
    try:
        cfg = load_config(args.config)
        day = date.fromisoformat(args.date) if args.date else datetime.now(UTC).date()
        result = run(
            cfg,
            CtGovClient(),
            Store(args.data_dir),
            args.raw_dir,
            args.site_dir,
            day,
            force=args.force,
            accept_drop=args.accept_drop,
            aliases_dir=_aliases(args, cfg),
        )
        status = result.status
        print(f"{result.status}: {result.changes} change(s) for {day.isoformat()}")
        for message in result.errors:
            print(f"error: {message}", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001 - any crash is a failed run
        _error(exc)
        status = "failed"
    written = _github_output(status)
    return 0 if status != "failed" and written else 1


def _check(args: argparse.Namespace) -> int:
    try:
        load_config(args.config)
    except Exception as exc:  # noqa: BLE001
        _error(exc)
        return 1
    print("OK")
    return 0


def _rebuild(args: argparse.Namespace) -> int:
    try:
        cfg = load_config(args.config)
        rebuild(cfg, args.data_dir, args.raw_dir, args.site_dir, _aliases(args, cfg))
    except Exception as exc:  # noqa: BLE001
        _error(exc)
        return 1
    print("rebuilt")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    handlers = {"run": _run, "check": _check, "rebuild": _rebuild}
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
