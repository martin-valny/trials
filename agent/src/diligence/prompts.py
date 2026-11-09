"""Prompts and tool schemas. Task 3 adds the system and checker prompts."""

from typing import Any

# Converse toolSpec for the final memo; the input schema mirrors types.Memo.
MEMO_TOOL: dict[str, Any] = {
    "toolSpec": {
        "name": "submit_memo",
        "description": (
            "Submit the finished diligence memo. Every section sentence must cite at least "
            "one ID retrieved by a tool in this run."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "sections": {
                        "type": "array",
                        "description": "One entry per sentence of the memo body.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "section": {
                                    "type": "string",
                                    "enum": [
                                        "landscape",
                                        "track_record",
                                        "literature",
                                        "competition",
                                    ],
                                },
                                "text": {"type": "string"},
                                "cites": {
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "pattern": (
                                            r"^(NCT\d{8}|PMID:\d+|PPR\d+|CHEMBL\d+|FDA:[A-Za-z0-9-]+)$"
                                        ),
                                    },
                                },
                            },
                            "required": ["id", "section", "text", "cites"],
                        },
                    },
                    "read": {
                        "type": "array",
                        "description": "The three-line read.",
                        "items": {"type": "string"},
                        "minItems": 3,
                        "maxItems": 3,
                    },
                    "judgement": {
                        "type": "object",
                        "properties": {
                            "stance": {"type": "string", "enum": ["favours", "mixed", "against"]},
                            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                            "reasons": {
                                "type": "array",
                                "description": "Sentence ids that support the judgement.",
                                "items": {"type": "string"},
                            },
                        },
                        "required": ["stance", "confidence", "reasons"],
                    },
                    "would_change": {
                        "type": "array",
                        "description": "What would change the judgement.",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 3,
                    },
                },
                "required": ["sections", "read", "judgement", "would_change"],
            }
        },
    }
}
