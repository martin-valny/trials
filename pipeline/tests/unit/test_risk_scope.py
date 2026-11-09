"""Tests for the stop-risk scope rules."""

from __future__ import annotations

import pytest

from trialradar.risk.scope import LABELS, RUNNING, has_drug, in_phase_scope


@pytest.mark.parametrize(
    ("phases", "expected"),
    [
        (["PHASE2", "PHASE3"], True),
        (["PHASE1"], True),
        (["EARLY_PHASE1", "PHASE1"], True),
        (["EARLY_PHASE1"], False),
        (["PHASE4"], False),
        ([], False),
        (["NA"], False),
    ],
)
def test_in_phase_scope(phases: list[str], expected: bool) -> None:
    assert in_phase_scope(phases) is expected


def test_has_drug() -> None:
    assert has_drug(["DEVICE", "BIOLOGICAL"])
    assert not has_drug(["DEVICE", "BEHAVIORAL"])


def test_constants() -> None:
    assert LABELS == {"COMPLETED": 0, "TERMINATED": 1}
    assert "RECRUITING" in RUNNING
    assert "COMPLETED" not in RUNNING
