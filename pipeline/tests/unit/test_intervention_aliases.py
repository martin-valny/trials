from __future__ import annotations

from pathlib import Path

from trialradar.textnorm import apply_alias, load_aliases

ALIASES = Path(__file__).resolve().parents[3] / "config" / "aliases" / "intervention.csv"


def test_truncated_and_misspelled_drug_names_fold_to_the_canonical_drug() -> None:
    aliases = load_aliases(ALIASES)
    assert apply_alias("OCR", aliases) == "ocrelizumab"
    assert apply_alias("ofatunumab", aliases) == "ofatumumab"
    assert apply_alias("Short-course ocrelizumab", aliases) == "ocrelizumab"
