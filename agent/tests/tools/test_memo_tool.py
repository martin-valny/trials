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
