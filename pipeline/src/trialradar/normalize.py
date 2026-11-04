"""Turn raw ClinicalTrials.gov v2 studies into typed tables."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Any

import polars as pl

from trialradar.tables import SCHEMAS, Tables
from trialradar.textnorm import apply_alias, load_aliases, norm_text, parse_ct_date


def _frame(name: str, rows: list[dict[str, Any]]) -> pl.DataFrame:
    return pl.DataFrame(rows, schema=SCHEMAS[name])


def _date_fields(prefix: str, struct: dict[str, Any] | None) -> dict[str, Any]:
    struct = struct or {}
    d, precision = parse_ct_date(struct.get("date"))
    return {prefix: d, f"{prefix}_precision": precision, f"{prefix}_type": struct.get("type")}


def normalize(studies: Iterable[dict[str, Any]], aliases_dir: Path) -> Tables:
    sponsor_aliases = load_aliases(aliases_dir / "sponsor.csv")
    intervention_aliases = load_aliases(aliases_dir / "intervention.csv")
    rows: dict[str, list[dict[str, Any]]] = {name: [] for name in SCHEMAS}

    for study in studies:
        ps = study.get("protocolSection") or {}
        ident = ps.get("identificationModule") or {}
        status = ps.get("statusModule") or {}
        design = ps.get("designModule") or {}
        spons = ps.get("sponsorCollaboratorsModule") or {}
        nct = ident["nctId"]

        lead = spons.get("leadSponsor") or {}
        lead_name = norm_text(lead.get("name"))
        lead_norm = apply_alias(lead_name, sponsor_aliases) if lead_name else None
        enroll = design.get("enrollmentInfo") or {}
        last_update, _ = parse_ct_date((status.get("lastUpdatePostDateStruct") or {}).get("date"))

        rows["trial"].append(
            {
                "nct_id": nct,
                "title": norm_text(ident.get("briefTitle")),
                "phases": sorted(design.get("phases") or []),
                "overall_status": status.get("overallStatus"),
                "why_stopped": norm_text(status.get("whyStopped")),
                **_date_fields("start_date", status.get("startDateStruct")),
                **_date_fields(
                    "primary_completion_date", status.get("primaryCompletionDateStruct")
                ),
                **_date_fields("completion_date", status.get("completionDateStruct")),
                "enrollment": enroll.get("count"),
                "enrollment_type": enroll.get("type"),
                "lead_sponsor": lead_norm,
                "sponsor_class": lead.get("class") if lead_name else None,
                "masking": ((design.get("designInfo") or {}).get("maskingInfo") or {}).get(
                    "masking"
                ),
                "allocation": (design.get("designInfo") or {}).get("allocation"),
                "last_update_post_date": last_update,
            }
        )

        for cond in (ps.get("conditionsModule") or {}).get("conditions") or []:
            if c := norm_text(cond):
                rows["condition"].append({"nct_id": nct, "condition": c})

        for iv in (ps.get("armsInterventionsModule") or {}).get("interventions") or []:
            if name := norm_text(iv.get("name")):
                rows["intervention"].append(
                    {
                        "nct_id": nct,
                        "type": iv.get("type"),
                        "name": name,
                        "name_normalized": apply_alias(name, intervention_aliases),
                    }
                )

        if lead_name:
            rows["sponsor"].append(
                {
                    "nct_id": nct,
                    "name": lead_name,
                    "name_normalized": lead_norm,
                    "role": "lead",
                    "class": lead.get("class"),
                }
            )
        for collab in spons.get("collaborators") or []:
            if name := norm_text(collab.get("name")):
                rows["sponsor"].append(
                    {
                        "nct_id": nct,
                        "name": name,
                        "name_normalized": apply_alias(name, sponsor_aliases),
                        "role": "collaborator",
                        "class": collab.get("class"),
                    }
                )

        for loc in (ps.get("contactsLocationsModule") or {}).get("locations") or []:
            rows["site"].append(
                {
                    "nct_id": nct,
                    "facility": norm_text(loc.get("facility")),
                    "city": norm_text(loc.get("city")),
                    "country": norm_text(loc.get("country")),
                    "status": loc.get("status"),
                }
            )

        outcomes = ps.get("outcomesModule") or {}
        for kind, key in (("primary", "primaryOutcomes"), ("secondary", "secondaryOutcomes")):
            for oc in outcomes.get(key) or []:
                rows["outcome"].append(
                    {
                        "nct_id": nct,
                        "kind": kind,
                        "measure": norm_text(oc.get("measure")),
                        "time_frame": norm_text(oc.get("timeFrame")),
                        "description": norm_text(oc.get("description")),
                    }
                )

    return Tables(**{name: _frame(name, r) for name, r in rows.items()})
