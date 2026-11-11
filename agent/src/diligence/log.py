"""Structured log lines for CloudWatch (stdout, one JSON object per line).

Error lines carry the exception class and a truncated message so a deploy problem
(AccessDeniedException, ValidationException, ...) can be diagnosed; pages only ever show the class.
"""

import json
from contextvars import ContextVar
from typing import Any

MAX_MESSAGE = 500
# The run being executed, so tool and checker errors can name it without threading it through.
current_run: ContextVar[str | None] = ContextVar("current_run", default=None)


def log_event(event: str, **fields: Any) -> None:
    print(json.dumps({"event": event, **fields}, default=str), flush=True)


def log_error(where: str, exc: BaseException) -> None:
    log_event(
        "error",
        run_id=current_run.get(),
        where=where,
        type=type(exc).__name__,
        message=str(exc)[:MAX_MESSAGE],
    )
