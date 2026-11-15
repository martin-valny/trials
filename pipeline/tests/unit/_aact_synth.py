"""A synthetic AACT panel in the real Task 2 layout (``panel/<table>/<date>.parquet``, every
column a string plus ``snapshot_date``), so ``load_snapshot`` and the v2 trainer run for real.

~600 trials over five quarterly snapshots up to the cutoff (2021-12-01) and an outcome
snapshot (2026-01-15). Half end (COMPLETED/TERMINATED) during 2021, before the cutoff (the
training trials); the other half are running at the cutoff and mostly end by 2026 (the
held-out trials). Planted signal: small planned enrollment stops more often.

Plus 150 trials that ended in 2012-2017 (never in scope at a snapshot: sponsor history only).

Special trials:
- ``RELABELLED``: TERMINATED at the cutoff, COMPLETED in the outcome snapshot.
- ``VANISHED``: ended before the cutoff, missing from the outcome snapshot.
- ``DEVICE``: a device-only trial (never in scope).
Every trial lists one more site in the outcome snapshot than before it ("post-cutoff edit").
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import polars as pl

from trialradar.aact.panel import TABLES

SNAPS = (
    date(2020, 12, 1),
    date(2021, 3, 1),
    date(2021, 6, 1),
    date(2021, 9, 1),
    date(2021, 12, 1),
    date(2026, 1, 15),
)
CUTOFF_SNAP = date(2021, 12, 1)
FINAL = SNAPS[-1]
MONTHLY = tuple(date(2020 + (11 + k) // 12, (11 + k) % 12 + 1, 1) for k in range(13))
RELABELLED = "NCT00000001"
VANISHED = "NCT00000002"
DEVICE = "NCT09999999"
_COUNTRIES = ("United States", "Germany", "Japan", "Brazil", "Canada", "France")


def _month(d: date, k: int) -> date:
    m = d.month - 1 + k
    return date(d.year + m // 12, m % 12 + 1, 1)


@dataclass(frozen=True)
class SynthTrial:
    nct: str
    start: date
    end: date | None  # None: still running at the outcome snapshot
    final: str  # status once ended (COMPLETED/TERMINATED/WITHDRAWN/...)
    at_cutoff: str | None  # status at the cutoff if it differs from `final` (relabelled)
    enrollment: int
    duration: int  # planned months, start -> primary completion
    phase: str
    sponsor: str
    industry: bool
    n_sites: int
    n_primary: int
    drug: bool = True
    in_final: bool = True

    def status(self, d: date) -> str | None:
        if self.end is not None and d >= self.end:
            if self.at_cutoff is not None and d <= CUTOFF_SNAP:
                return self.at_cutoff
            return self.final
        return "RECRUITING" if d >= self.start else "NOT_YET_RECRUITING"


def trials(n: int = 600, seed: int = 0) -> list[SynthTrial]:
    rng = random.Random(seed)
    out: list[SynthTrial] = []
    for i in range(n):
        enrollment = int(math.exp(rng.uniform(math.log(10), math.log(1000))))
        z = math.log(enrollment) - math.log(100)
        stopped = rng.random() < 1 / (1 + math.exp(1.6 * z + 1.0))
        industry = rng.random() < 0.5
        phase = ("PHASE1", "PHASE2", "PHASE3", "PHASE1/PHASE2")[i % 4]
        status = "TERMINATED" if stopped else "COMPLETED"
        duration = rng.randint(12, 48)
        if i < n // 2:  # ended during 2021, before the cutoff: training trials
            end: date | None = date(2021, rng.randint(1, 11), 15)
            assert end is not None
            start = _month(end, -rng.randint(6, 40))
            start = max(start, date(2016, 1, 1))
        else:  # running at the cutoff; most end by 2026
            start = date(rng.randint(2017, 2021), rng.randint(1, 11), 1)
            r = rng.random()
            end = None if r < 0.12 else date(rng.randint(2022, 2025), rng.randint(1, 12), 1)
            if 0.12 <= r < 0.15:
                status = "WITHDRAWN"
            elif 0.15 <= r < 0.17:
                status = "UNKNOWN"
        nct = f"NCT{i + 1:08d}"
        out.append(
            SynthTrial(
                nct=nct,
                start=start,
                end=end,
                final=status if nct != RELABELLED else "COMPLETED",
                at_cutoff="TERMINATED" if nct == RELABELLED else None,
                enrollment=enrollment,
                duration=duration,
                phase=phase,
                sponsor=f"Sponsor {i % 9}",
                industry=industry,
                n_sites=rng.randint(1, 12),
                n_primary=rng.randint(1, 3),
                in_final=nct != VANISHED,
            )
        )
    for k in range(150):  # ended long before the first snapshot: sponsor track record only
        end = date(2012 + k % 6, 1 + k % 12, 1)
        out.append(
            SynthTrial(
                nct=f"NCT0500{k:04d}", start=_month(end, -30), end=end,
                final="TERMINATED" if rng.random() < 0.25 else "COMPLETED", at_cutoff=None,
                enrollment=100, duration=30, phase="PHASE2", sponsor=f"Sponsor {k % 9}",
                industry=k % 2 == 0, n_sites=3, n_primary=1,
            )
        )  # fmt: skip
    out.append(
        SynthTrial(
            nct=DEVICE, start=date(2019, 1, 1), end=None, final="RECRUITING", at_cutoff=None,
            enrollment=50, duration=24, phase="PHASE2", sponsor="Sponsor 0", industry=True,
            n_sites=2, n_primary=1, drug=False,
        )
    )  # fmt: skip
    return out


def _study(t: SynthTrial, d: date, status: str) -> dict[str, Any]:
    pcd = _month(t.start, t.duration)
    ended = t.end is not None and d >= t.end
    enrollment = t.enrollment if not ended or status == "COMPLETED" else max(1, t.enrollment // 3)
    return {
        "nct_id": t.nct,
        "study_type": "INTERVENTIONAL",
        "overall_status": status,
        "phase": t.phase,
        "start_date": t.start.isoformat(),
        "start_month_year": t.start.strftime("%Y-%m"),
        "start_date_type": "ACTUAL" if d >= t.start else "ESTIMATED",
        "primary_completion_date": pcd.isoformat(),
        "primary_completion_month_year": pcd.strftime("%Y-%m"),
        "primary_completion_date_type": "ESTIMATED",
        "completion_date": (t.end or _month(pcd, 6)).isoformat(),
        "completion_month_year": (t.end or _month(pcd, 6)).strftime("%Y-%m"),
        "enrollment": str(enrollment),
        "enrollment_type": "ACTUAL" if ended else "ESTIMATED",
        "last_update_posted_date": (d - timedelta(days=17 + int(t.nct[-2:]))).isoformat(),
        "results_first_posted_date": None,
        "source_class": "INDUSTRY" if t.industry else "OTHER",
    }


def snapshot_rows(ts: list[SynthTrial], d: date) -> dict[str, list[dict[str, Any]]]:
    rows: dict[str, list[dict[str, Any]]] = {t: [] for t in TABLES}
    for t in ts:
        status = t.status(d)
        if status is None or (d == FINAL and not t.in_final):
            continue
        n = t.nct
        rows["studies"].append(_study(t, d, status))
        rows["interventions"].append(
            {"nct_id": n, "intervention_type": "DRUG" if t.drug else "DEVICE", "name": f"d{n}"}
        )
        sites = t.n_sites + (1 if d == FINAL else 0)
        rows["facilities"].extend(
            {"nct_id": n, "name": f"Site {k}", "city": "X",
             "country": _COUNTRIES[(k + int(n[-1])) % len(_COUNTRIES)], "status": "RECRUITING"}
            for k in range(sites)
        )  # fmt: skip
        rows["design_groups"].extend(
            {"nct_id": n, "group_type": "EXPERIMENTAL" if k == 0 else "PLACEBO_COMPARATOR"}
            for k in range(1 + int(n[-1]) % 2)
        )
        rows["design_outcomes"].extend(
            {"nct_id": n, "outcome_type": "primary"} for _ in range(t.n_primary)
        )
        rows["conditions"].append({"nct_id": n, "name": "Asthma" if int(n[-1]) % 2 else "Cancer"})
        rows["browse_conditions"].append(
            {"nct_id": n, "mesh_term": "Neoplasms", "mesh_type": "mesh-list"}
        )
        rows["sponsors"].append(
            {"nct_id": n, "name": t.sponsor, "lead_or_collaborator": "lead",
             "agency_class": "INDUSTRY" if t.industry else "OTHER"}
        )  # fmt: skip
        rows["designs"].append({"nct_id": n, "allocation": "RANDOMIZED", "masking": "DOUBLE"})
    return rows


def write_panel(panel: Path, ts: list[SynthTrial] | None = None) -> list[SynthTrial]:
    """Write every snapshot (and monthly studies 2020-12..2021-12) under `panel`."""
    ts = trials() if ts is None else ts
    for d in SNAPS:
        for table, rows in snapshot_rows(ts, d).items():
            cols = TABLES[table]
            df = pl.DataFrame(
                [{c: r.get(c) for c in cols} for r in rows], schema=dict.fromkeys(cols, pl.String)
            ).with_columns(snapshot_date=pl.lit(d))
            (panel / table).mkdir(parents=True, exist_ok=True)
            df.write_parquet(panel / table / f"{d.isoformat()}.parquet")
    (panel / "studies_monthly").mkdir(parents=True, exist_ok=True)
    for d in MONTHLY:
        studies = snapshot_rows(ts, d)["studies"]
        pl.DataFrame(
            [{c: r.get(c) for c in TABLES["studies"]} for r in studies],
            schema=dict.fromkeys(TABLES["studies"], pl.String),
        ).write_parquet(panel / "studies_monthly" / f"{d.isoformat()}.parquet")
    return ts
