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
    drugs: TrialDrugs, mappings: Mapping[str, DrugMapping]
) -> dict[str, TrialMechanisms]:
    """The sorted union over each trial's drugs; ``unmapped`` and ``not_a_drug`` add nothing.

    Modalities are single values: a drug's ``;``-joined modality cell is split."""
    out: dict[str, TrialMechanisms] = {}
    for nct, names in drugs.items():
        mech: set[str] = set()
        targets: set[str] = set()
        modalities: set[str] = set()
        for name in names:
            m = mappings.get(name)
            if m is None or m.status in ("unmapped", "not_a_drug"):
                continue
            mech.update(m.mechanism_class)
            targets.update(m.targets)
            # A drug may list several modalities, ";"-joined: the trial gets each one.
            modalities.update(split_cell(m.modality))
        out[nct] = TrialMechanisms(
            tuple(sorted(mech)), tuple(sorted(targets)), tuple(sorted(modalities))
        )
    return out


def load_trial_mechanisms(
    cfg: AreaConfig, drugs: TrialDrugs, warnings: list[str]
) -> dict[str, TrialMechanisms]:
    try:
        mappings = read_mappings(cfg.mechanisms_dir)
    except (OSError, ValueError) as exc:
        warnings.append(f"explorer_mechanisms: {exc}")
        return {nct: TrialMechanisms() for nct in drugs}
    unmapped = {
        d
        for names in drugs.values()
        for d in names
        if d not in mappings or mappings[d].status == "unmapped"
    }
    if unmapped:
        n_trials = sum(1 for names in drugs.values() if names & unmapped)
        warnings.append(f"mechanism_unmapped: {len(unmapped)} drugs ({n_trials} trials)")
    return trial_mechanisms(drugs, mappings)
