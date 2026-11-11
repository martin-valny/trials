"""Build the synthetic CI recording with the real loop, a scripted model and fixture-backed tools.

Free and offline. Re-run after any prompt, tool-schema or model-ID change:

    cd agent && uv run python scripts/make_synthetic_recording.py
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from diligence.config import load_config
from diligence.loop import RunRequest
from diligence.model import ModelResponse
from diligence.recording import record_run
from diligence.tools.http import client
from diligence.tools.registry_of_tools import ToolContext
from diligence.tools.site import row_fingerprint

AGENT = Path(__file__).resolve().parents[1]
SITE = AGENT / "tests" / "fixtures" / "http" / "site"
OUT = AGENT / "tests" / "fixtures" / "recordings" / "synthetic.jsonl"
BASE = "https://example.test/data/"
FIXED_NOW = datetime(2026, 11, 9, 12, 0, 0, tzinfo=UTC)


def fixture_http() -> httpx.Client:
    """An http client serving the site fixtures; anything else is a 404."""

    def handler(request: httpx.Request) -> httpx.Response:
        rel = str(request.url).removeprefix(BASE)
        path = SITE / rel
        if str(request.url).startswith(BASE) and path.is_file():
            return httpx.Response(200, json=json.loads(path.read_text()))
        return httpx.Response(404)

    return client(transport=httpx.MockTransport(handler), sleep=lambda _s: None)


def _use(name: str, args: dict[str, Any], uid: str) -> dict[str, Any]:
    return {"toolUse": {"toolUseId": uid, "name": name, "input": args}}


MEMO: dict[str, Any] = {
    "sections": [
        {
            "id": "s1",
            "section": "landscape",
            "text": "Three trials of CD20 in MS are listed, one of them stopped.",
            "cites": ["NCT90000001"],
        },
        {
            "id": "s2",
            "section": "track_record",
            "text": "The stopped trial ended after an interim safety review.",
            "cites": ["NCT90000001"],
        },
        {
            "id": "s3",
            "section": "landscape",
            "text": "The two running trials carry a stop risk near a quarter.",
            "cites": ["NCT90000002", "NCT90000004"],
        },
        {
            "id": "s4",
            "section": "competition",
            "text": "A competing programme reported a positive phase 3 result.",
            "cites": ["NCT90000004"],
        },
        {
            # A count from a tool's summary field (site_risk summary n) and a percent from a
            # risk p (0.244): both must pass the deterministic number check (R37).
            "id": "s5",
            "section": "competition",
            "text": (
                "The site's stop-risk model covers 14 trials of this target in MS and gives "
                "the first running trial a 24% chance of stopping early."
            ),
            "cites": ["NCT90000002"],
        },
    ],
    "read": [
        "CD20 depletion is established in MS.",
        "Few trials remain running here.",
        "Whether the stopped trial signals a class issue is open.",
    ],
    "judgement": {"stance": "mixed", "confidence": "low", "reasons": ["s1", "s3"]},
    "would_change": ["A phase 3 readout in the running trials."],
}

VERDICTS = [
    {"sentence_id": "s1", "verdict": "supported", "reason": "Three listed, one stopped."},
    {
        "sentence_id": "s2",
        "verdict": "partly",
        "reason": "The source says sponsor decision after interim safety review, not a cause.",
    },
    {"sentence_id": "s3", "verdict": "supported", "reason": "Risk estimates are near 0.24."},
    {"sentence_id": "s4", "verdict": "unsupported", "reason": "Nothing in the source says this."},
    {"sentence_id": "s5", "verdict": "supported", "reason": "Summary n is 14; p is 0.244."},
]


class ScriptedModel:
    """Returns canned responses in order."""

    def __init__(self, responses: list[ModelResponse]) -> None:
        self._responses = list(responses)

    def converse(self, **_kw: Any) -> ModelResponse:
        return self._responses.pop(0)


def scripted_model() -> ScriptedModel:
    args = {"target": "cd20", "disease": "MS"}
    return ScriptedModel(
        [
            ModelResponse(
                "tool_use",
                [_use("site_target", args, "t1"), _use("site_risk", args, "t2")],
                900,
                80,
            ),
            ModelResponse(
                "tool_use",
                [_use("ready_to_write", {"notes": "Three trials, two risk estimates."}, "d1")],
                2400,
                40,
                cache_read=900,
            ),
            ModelResponse("tool_use", [_use("submit_memo", MEMO, "w1")], 2600, 480),
            ModelResponse(
                "tool_use",
                [_use("submit_verdicts", {"verdicts": VERDICTS}, "c1")],
                700,
                120,
            ),
        ]
    )


def main(out: Path = OUT) -> int:
    cfg = load_config()
    http = fixture_http()
    pipeline = http.get(BASE + "pipeline.json").json()
    risk = http.get(BASE + "risk.json").json()
    rec = record_run(
        out,
        req=RunRequest("cd20", "MS"),
        cfg=cfg,
        model=scripted_model(),
        ctx=ToolContext(http=http, base_url=BASE),
        fingerprint=row_fingerprint(pipeline, risk, "cd20", "MS"),
        data_date="2026-11-04",
        label="CD20",
        clock=lambda: 0.0,
        now=lambda: FIXED_NOW,
    )
    print(f"wrote {out} ({rec.status}, {len(rec.verdicts)} verdicts, {len(rec.removed)} removed)")
    return 0 if rec.status == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
