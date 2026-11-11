"""openFDA drug-label client: reuses the ChEMBL client's cached, retrying transport."""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from pathlib import Path

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

    def __init__(
        self,
        http: httpx.Client | None = None,
        cache_dir: Path | None = None,
        *,
        base_url: str = BASE_URL,
        record_dir: Path | None = None,
        record: Callable[[str, Json], Json] | None = None,
        sleep: Callable[[float], None] = time.sleep,
        rng: Callable[[float, float], float] = random.uniform,
    ) -> None:
        super().__init__(
            http,
            cache_dir,
            base_url=base_url,
            record_dir=record_dir,
            record=record,
            sleep=sleep,
            rng=rng,
        )

    def _accepted_error(self, resp: httpx.Response) -> Json | None:
        # openFDA answers "no matches" with 404 NOT_FOUND; treat it as an empty result.
        return {"results": []} if _is_not_found(resp) else None

    def labels(self, generic_name: str) -> list[Json]:
        """Labels naming ``generic_name`` in ``openfda.generic_name`` or in the SPL product
        elements (newer labels have no ``openfda`` block), reduced to ``set_id``,
        ``generic_name`` (the ``openfda`` names joined by "; ", or ""), ``indications`` (the
        ``indications_and_usage`` paragraphs joined by a space) and ``product`` (the first
        ``spl_product_data_elements`` entry, or "").

        One request with ``limit=100`` (no paging): enough labels for any one generic name.
        An unmatched name (404 NOT_FOUND) gives ``[]``, and that empty result is cached too.
        """
        search = f'openfda.generic_name:"{generic_name}" spl_product_data_elements:"{generic_name}"'
        body = self._get("drug/label.json", {"search": search, "limit": LABEL_LIMIT})
        results = body.get("results")
        labels: list[Json] = []
        for item in results if isinstance(results, list) else []:
            if not isinstance(item, dict):
                continue
            openfda = item.get("openfda")
            names = openfda.get("generic_name") if isinstance(openfda, dict) else None
            usage = item.get("indications_and_usage")
            product = item.get("spl_product_data_elements")
            labels.append(
                {
                    "set_id": str(item.get("set_id") or ""),
                    "generic_name": "; ".join(str(n) for n in names)
                    if isinstance(names, list)
                    else "",
                    "indications": " ".join(str(u) for u in usage)
                    if isinstance(usage, list)
                    else "",
                    "product": str(product[0]) if isinstance(product, list) and product else "",
                }
            )
        return labels
