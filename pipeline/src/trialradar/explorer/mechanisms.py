"""Per-trial mechanisms, targets and modalities from the drug mapping files (R19)."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from trialradar.config import AreaConfig
from trialradar.explorer.outcomes import TrialDrugs
from trialradar.mechanisms.io import DrugMapping, read_mappings, split_cell


@dataclass(frozen=True)
class TrialMechanisms:
    mechanisms: tuple[str, ...] = ()
    targets: tuple[str, ...] = ()
    modalities: tuple[str, ...] = ()


def trial_mechanisms(
    drugs: TrialDrugs,
    mappings: Mapping[str, DrugMapping],
    kind_keys: frozenset[str] = frozenset(),
) -> dict[str, TrialMechanisms]:
    """The sorted union over each trial's names; ``unmapped`` and ``not_a_drug`` add nothing.

    ``drugs`` may hold more than the experimental drugs (supplement, genetic and combination
    names reach the mapping too). Mechanisms are molecular classes only: a class that is a key
    in ``kind_keys`` (an approach kind such as ``msc``) never appears. Modalities are single
    values: a drug's ``;``-joined modality cell is split."""
    out: dict[str, TrialMechanisms] = {}
    for nct, names in drugs.items():
        mech: set[str] = set()
        targets: set[str] = set()
        modalities: set[str] = set()
        for name in names:
            m = mappings.get(name)
            if m is None or m.status in ("unmapped", "not_a_drug"):
                continue
            mech.update(c for c in m.mechanism_class if c not in kind_keys)
            targets.update(m.targets)
            # A drug may list several modalities, ";"-joined: the trial gets each one.
            modalities.update(split_cell(m.modality))
        out[nct] = TrialMechanisms(
            tuple(sorted(mech)), tuple(sorted(targets)), tuple(sorted(modalities))
        )
    return out


def read_mappings_or_warn(cfg: AreaConfig, warnings: list[str]) -> dict[str, DrugMapping] | None:
    """The drug mapping, or ``None`` with an ``explorer_mechanisms:`` warning (R19)."""
    try:
        return read_mappings(cfg.mechanisms_dir)
    except (OSError, ValueError) as exc:
        warnings.append(f"explorer_mechanisms: {exc}")
        return None


def mechanisms_from(
    mappings: Mapping[str, DrugMapping] | None,
    drugs: TrialDrugs,
    warnings: list[str],
    names: TrialDrugs | None = None,
    kind_keys: frozenset[str] = frozenset(),
) -> dict[str, TrialMechanisms]:
    """Per-trial fields from ``names`` (default: ``drugs``); the unmapped warning counts
    ``drugs`` only (an unmapped supplement falls to its type fallback and is not a gap)."""
    names = drugs if names is None else names
    if mappings is None:
        return {nct: TrialMechanisms() for nct in names}
    unmapped = {
        d
        for ds in drugs.values()
        for d in ds
        if d not in mappings or mappings[d].status == "unmapped"
    }
    if unmapped:
        n_trials = sum(1 for ds in drugs.values() if ds & unmapped)
        warnings.append(f"mechanism_unmapped: {len(unmapped)} drugs ({n_trials} trials)")
    return trial_mechanisms(names, mappings, kind_keys)


def load_trial_mechanisms(
    cfg: AreaConfig,
    drugs: TrialDrugs,
    warnings: list[str],
    names: TrialDrugs | None = None,
    kind_keys: frozenset[str] = frozenset(),
) -> dict[str, TrialMechanisms]:
    return mechanisms_from(read_mappings_or_warn(cfg, warnings), drugs, warnings, names, kind_keys)
