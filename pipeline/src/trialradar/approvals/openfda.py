"""openFDA drug-label client: reuses the ChEMBL client's cached, retrying transport."""

from __future__ import annotations

from typing import Any

import httpx

from trialradar.mechanisms.chembl import Json, JsonClient

BASE_URL = "https://api.fda.gov"
LABEL_LIMIT = 100


class OpenFdaError(RuntimeError):
    """Raised when openFDA fails after retries or returns a non-retryable error."""


def _is_not_found(resp: httpx.Response) -> bool:
    if resp.status_code != 404:
        return False
    try:
        body = resp.json()
    except ValueError:
        return False
    error = body.get("error") if isinstance(body, dict) else None
    return isinstance(error, dict) and error.get("code") == "NOT_FOUND"


class OpenFdaClient(JsonClient):
    error_class = OpenFdaError

    def __init__(self, *args: Any, base_url: str = BASE_URL, **kwargs: Any) -> None:
        super().__init__(*args, base_url=base_url, **kwargs)

    def _accepted_error(self, resp: httpx.Response) -> Json | None:
        # openFDA answers "no matches" with 404 NOT_FOUND; treat it as an empty result.
        return {"results": []} if _is_not_found(resp) else None

    def labels(self, generic_name: str) -> list[Json]:
        """Labels whose ``openfda.generic_name`` matches, reduced to ``set_id``, ``generic_name``
        and ``indications`` (the ``indications_and_usage`` paragraphs joined by a space).

        One request with ``limit=100`` (no paging): enough labels for any one generic name.
        An unmatched name (404 NOT_FOUND) gives ``[]``, and that empty result is cached too.
        """
        body = self._get(
            "drug/label.json",
            {"search": f'openfda.generic_name:"{generic_name}"', "limit": LABEL_LIMIT},
        )
        results = body.get("results")
        labels: list[Json] = []
        for item in results if isinstance(results, list) else []:
            if not isinstance(item, dict):
                continue
            openfda = item.get("openfda")
            names = openfda.get("generic_name") if isinstance(openfda, dict) else None
            usage = item.get("indications_and_usage")
            labels.append(
                {
                    "set_id": str(item.get("set_id") or ""),
                    "generic_name": str(names[0]) if isinstance(names, list) and names else "",
                    "indications": " ".join(str(u) for u in usage)
                    if isinstance(usage, list)
                    else "",
                }
            )
        return labels
