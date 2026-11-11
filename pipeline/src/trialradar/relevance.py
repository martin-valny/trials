"""Client-side relevance filter: keep only studies in the configured area."""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from typing import Any

from trialradar.config import AreaConfig
from trialradar.textnorm import norm_key


def _dig(node: Any, *path: str) -> Any:
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def _strings(value: Any) -> Iterator[str]:
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                yield item


def _texts(study: dict[str, Any]) -> list[str]:
    """Condition, keyword and MeSH-term strings of ``study`` as comparison keys."""
    raw: list[str] = []
    raw.extend(_strings(_dig(study, "protocolSection", "conditionsModule", "conditions")))
    raw.extend(_strings(_dig(study, "protocolSection", "conditionsModule", "keywords")))
    meshes = _dig(study, "derivedSection", "conditionBrowseModule", "meshes")
    if isinstance(meshes, list):
        for mesh in meshes:
            term = _dig(mesh, "term")
            if isinstance(term, str):
                raw.append(term)
    return [key for text in raw if (key := norm_key(text))]


def _pattern(cfg: AreaConfig) -> re.Pattern[str] | None:
    keys = {norm_key(s) for spec in cfg.conditions for s in spec.synonyms}
    keys.discard("")
    if not keys:
        return None
    alternatives = "|".join(re.escape(k) for k in sorted(keys, key=len, reverse=True))
    return re.compile(rf"(?<!\w)(?:{alternatives})(?!\w)")


def condition_labels(study: dict[str, Any], cfg: AreaConfig) -> list[str]:
    """Config labels (config order) whose synonyms match the study's conditions,
    keywords or MeSH terms, using the same matching as ``is_relevant``."""
    texts = _texts(study)
    labels: list[str] = []
    for spec in cfg.conditions:
        keys = {k for s in spec.synonyms if (k := norm_key(s))}
        if not keys:
            continue
        alternatives = "|".join(re.escape(k) for k in sorted(keys, key=len, reverse=True))
        pattern = re.compile(rf"(?<!\w)(?:{alternatives})(?!\w)")
        if any(pattern.search(t) for t in texts):
            labels.append(spec.label)
    return labels


def is_relevant(study: dict[str, Any], cfg: AreaConfig) -> bool:
    """True if a configured synonym occurs as a whole phrase in the study's conditions,
    keywords or MeSH condition terms (the title is deliberately not used)."""
    pattern = _pattern(cfg)
    return pattern is not None and any(pattern.search(t) for t in _texts(study))


def filter_relevant(studies: Iterable[dict[str, Any]], cfg: AreaConfig) -> list[dict[str, Any]]:
    """Relevant studies, input order preserved."""
    pattern = _pattern(cfg)
    if pattern is None:
        return []
    return [s for s in studies if any(pattern.search(t) for t in _texts(s))]
