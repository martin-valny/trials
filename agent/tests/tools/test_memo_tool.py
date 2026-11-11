from diligence.prompts import MEMO_TOOL
from diligence.types import Memo


def test_memo_tool_schema_mirrors_memo_model() -> None:
    schema = MEMO_TOOL["toolSpec"]["inputSchema"]["json"]
    assert set(schema["properties"]) == set(Memo.model_fields)
    item = schema["properties"]["sections"]["items"]
    assert set(item["properties"]) == {"id", "section", "text", "cites"}
    assert item["properties"]["section"]["enum"] == [
        "landscape",
        "track_record",
        "literature",
        "competition",
    ]
    assert (schema["properties"]["read"]["minItems"], schema["properties"]["read"]["maxItems"]) == (
        3,
        3,
    )


def test_memo_tool_patterns_match_the_types() -> None:
    """I1/R36 and Minor 2: the schema patterns are the types' own regexes, anchored."""
    import re

    from diligence.prompts import SYSTEM_PROMPT
    from diligence.types import CITE_PATTERN, SENTENCE_ID_PATTERN

    item = MEMO_TOOL["toolSpec"]["inputSchema"]["json"]["properties"]["sections"]["items"]
    id_pattern = item["properties"]["id"]["pattern"]
    cite_pattern = item["properties"]["cites"]["items"]["pattern"]
    assert id_pattern == f"^{SENTENCE_ID_PATTERN.pattern}$"
    assert cite_pattern == f"^{CITE_PATTERN.pattern}$"
    for good in ("s1", "s42"):
        assert re.fullmatch(id_pattern, good)
    for bad in ("L1", "1", "landscape-1"):
        assert not re.fullmatch(id_pattern, bad)
    assert "sentence ids s1, s2, s3" in SYSTEM_PROMPT
