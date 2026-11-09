import subprocess
import sys
from pathlib import Path
from typing import Any

from trialradar.approvals.build import Review, build_approvals
from trialradar.approvals.io import Override
from trialradar.config import ApprovalTerms
from trialradar.mechanisms.io import DrugMapping
from trialradar.pipeline_figure.io import FigureRow

Json = dict[str, Any]

TERMS = {
    "MS": ApprovalTerms(mesh=["Multiple Sclerosis"], label_terms=["multiple sclerosis"]),
    "MG": ApprovalTerms(mesh=["Myasthenia Gravis"], label_terms=["myasthenia gravis"]),
}


class FakeChembl:
    def __init__(
        self,
        molecules: dict[str, Json],
        mechs: list[Json],
        indications: dict[str, list[Json]],
    ) -> None:
        self._mol = molecules
        self._mechs = mechs
        self._ind = indications

    def molecule(self, chembl_id: str) -> Json:
        return self._mol[chembl_id]

    def mechanisms(self, parent_id: str) -> list[Json]:
        return [m for m in self._mechs if m["molecule_chembl_id"] == parent_id]

    def mechanisms_on_target(self, target_id: str) -> list[Json]:
        return [m for m in self._mechs if m["target_chembl_id"] == target_id]

    def indications(self, parent_id: str) -> list[Json]:
        return self._ind.get(parent_id, [])


class FakeFda:
    def __init__(self, labels: dict[str, list[Json]] | None = None) -> None:
        self._labels = labels or {}

    def labels(self, generic_name: str) -> list[Json]:
        return self._labels.get(generic_name, [])


def mech(mol: str, target: str, action: str = "inhibitor") -> Json:
    return {
        "molecule_chembl_id": mol,
        "parent_molecule_chembl_id": mol,
        "target_chembl_id": target,
        "action_type": action,
    }


def ind(mesh: str, phase: int) -> Json:
    return {"mesh_heading": mesh, "efo_term": None, "max_phase_for_ind": phase}


def mol(name: str | None, kind: str = "Antibody", withdrawn: bool = False) -> Json:
    return {"pref_name": name, "molecule_type": kind, "withdrawn_flag": withdrawn}


def mapping(drug: str, cid: str, cls: tuple[str, ...]) -> DrugMapping:
    return DrugMapping(drug, "mapped", cid, None, cls, (), (), ())


def row(rid: str, classes: tuple[str, ...] = (), drugs: tuple[str, ...] = ()) -> FigureRow:
    return FigureRow(rid, rid, "", "fam", 1, classes, drugs, None, "", ())


def label(set_id: str, text: str) -> Json:
    return {"set_id": set_id, "generic_name": "x", "indications": text}


def run(
    rows: list[FigureRow],
    mappings: dict[str, DrugMapping],
    chembl: FakeChembl,
    fda: FakeFda | None = None,
    overrides: list[Override] | None = None,
) -> tuple[list[Any], Review]:
    return build_approvals(rows, mappings, TERMS, chembl, fda or FakeFda(), overrides or [])


def cd20_world() -> tuple[dict[str, DrugMapping], FakeChembl]:
    chembl = FakeChembl(
        {"C1": mol("Ocrelizumab"), "C2": mol("Ofatumumab"), "C3": mol("Smallmol", "Small molecule")},
        [mech("C1", "T1"), mech("C2", "T1"), mech("C3", "T1")],
        {"C1": [ind("Multiple Sclerosis", 4)], "C2": [ind("Multiple Sclerosis", 4)],
         "C3": [ind("Multiple Sclerosis", 4)]},
    )  # fmt: skip
    return {"ocrelizumab": mapping("ocrelizumab", "C1", ("CD20",))}, chembl


def test_class_row_widens_and_matches() -> None:
    mappings, chembl = cd20_world()
    items, review = run([row("cd20", ("CD20",))], mappings, chembl)
    assert [(a.drug, a.disease, a.sources) for a in items] == [
        ("ocrelizumab", "MS", ("chembl",)),
        ("ofatumumab", "MS", ("chembl",)),
    ]  # the small molecule on the same target is another modality
    assert review.counts == {"MG": 0, "MS": 1}
    assert len(review.one_source) == 2


def test_named_drug_row_not_widened() -> None:
    chembl = FakeChembl(
        {"C1": mol("Cladribine", "Small molecule"), "C2": mol("Mitoxantrone", "Small molecule")},
        [mech("C1", "T1"), mech("C2", "T1")],
        {"C1": [ind("Multiple Sclerosis", 4)], "C2": [ind("Multiple Sclerosis", 4)]},
    )
    mappings = {"cladribine": mapping("cladribine", "C1", ("DNA",))}
    items, _ = run([row("clad", drugs=("Cladribine",))], mappings, chembl)
    assert [a.drug for a in items] == ["cladribine"]


def test_seed_without_target_still_counts() -> None:
    chembl = FakeChembl({"C1": mol("Zed")}, [], {"C1": [ind("Multiple Sclerosis", 4)]})
    items, _ = run([row("r", ("X",))], {"zed": mapping("zed", "C1", ("X",))}, chembl)
    assert [a.drug for a in items] == ["zed"]


def test_fda_only_approval() -> None:
    chembl = FakeChembl(
        {"C1": mol("Eculizumab")}, [mech("C1", "T1")], {"C1": [ind("Myasthenia Gravis", 3)]}
    )
    fda = FakeFda({"eculizumab": [label("SET1", "Indicated for generalized myasthenia gravis.")]})
    items, review = run(
        [row("c5", ("C5",))], {"eculizumab": mapping("eculizumab", "C1", ("C5",))}, chembl, fda
    )
    assert [(a.disease, a.sources) for a in items] == [("MG", ("fda_label",))]
    assert items[0].url.endswith("setid=SET1")
    assert review.disagree == ["c5 × MG: eculizumab — FDA label yes, ChEMBL below phase 4"]
    assert review.one_source == []


def test_disagree_when_label_lacks_phrase_and_one_source_without_labels() -> None:
    mappings, chembl = cd20_world()
    fda = FakeFda({"ocrelizumab": [label("S", "Indicated for lupus.")]})
    _, review = run([row("cd20", ("CD20",))], mappings, chembl, fda)
    assert review.disagree == [
        "cd20 × MS: ocrelizumab — ChEMBL phase 4, FDA label does not name it"
    ]
    assert review.one_source == ["cd20 × MS: ofatumumab — ChEMBL only"]


def test_both_sources_agree_is_not_reviewed() -> None:
    mappings, chembl = cd20_world()
    fda = FakeFda({"ocrelizumab": [label("S", "Relapsing multiple sclerosis.")]})
    items, review = run([row("cd20", ("CD20",))], mappings, chembl, fda)
    assert items[0].sources == ("chembl", "fda_label")
    assert all("ocrelizumab" not in line for line in review.one_source + review.disagree)


def test_review_lists_negations() -> None:
    chembl = FakeChembl({"C1": mol("Drugx")}, [mech("C1", "T1")], {})
    fda = FakeFda(
        {"drugx": [label("S", "Limitations of use: not indicated for myasthenia gravis.")]}
    )
    items, review = run([row("r", ("X",))], {"drugx": mapping("drugx", "C1", ("X",))}, chembl, fda)
    assert items == []
    assert len(review.negated) == 1
    assert review.negated[0].startswith("r × MG: drugx — ")


def test_withdrawn_flag_carried() -> None:
    chembl = FakeChembl(
        {"C1": mol("Natalizumab", withdrawn=True)},
        [mech("C1", "T1")],
        {"C1": [ind("Multiple Sclerosis", 4)]},
    )
    items, _ = run(
        [row("r", ("X",))], {"natalizumab": mapping("natalizumab", "C1", ("X",))}, chembl
    )
    assert items[0].withdrawn is True


def hand(action: str, drug: str, **kw: Any) -> Override:
    base: dict[str, Any] = {
        "action": action, "row_id": "cd20", "disease": "MS", "drug": drug, "regulator": "",
        "year": None, "withdrawn": False, "source_url": "", "note": "",
    }  # fmt: skip
    return Override(**{**base, **kw})  # type: ignore[arg-type]


def test_override_add_and_exclude() -> None:
    mappings, chembl = cd20_world()
    overrides = [
        hand("exclude", "Ofatumumab"),
        hand("exclude", "nothing"),
        hand("add", "Zilucoplan", disease="MG", row_id="c5", regulator="FDA", year=2023,
             source_url="https://hand/z"),
        hand("add", "ocrelizumab", regulator="EMA", year=2018, source_url="https://hand/o"),
    ]  # fmt: skip
    items, review = run([row("cd20", ("CD20",))], mappings, chembl, overrides=overrides)
    got = {(a.row_id, a.disease, a.drug): a for a in items}
    assert ("cd20", "MS", "ofatumumab") not in got
    zil = got[("c5", "MG", "Zilucoplan")]
    assert (zil.chembl_id, zil.sources, zil.regulator, zil.year) == ("", ("hand",), "FDA", 2023)
    oc = got[("cd20", "MS", "ocrelizumab")]
    assert oc.sources == ("chembl", "hand")
    assert (oc.chembl_id, oc.regulator, oc.year, oc.url) == ("C1", "EMA", 2018, "https://hand/o")
    assert len(review.hand) == 4
    assert any(line.endswith("exclude (no match)") for line in review.hand)


def test_override_marks_withdrawn() -> None:
    mappings, chembl = cd20_world()
    items, _ = run(
        [row("cd20", ("CD20",))],
        mappings,
        chembl,
        overrides=[hand("add", "ocrelizumab", withdrawn=True, source_url="https://h")],
    )
    assert {a.drug: a.withdrawn for a in items} == {"ocrelizumab": True, "ofatumumab": False}


def test_condition_without_terms_ignored() -> None:
    chembl = FakeChembl({"C1": mol("Drugx")}, [mech("C1", "T1")], {"C1": [ind("Narcolepsy", 4)]})
    items, review = run([row("r", ("X",))], {"drugx": mapping("drugx", "C1", ("X",))}, chembl)
    assert items == []
    assert review.counts == {"MG": 0, "MS": 0}


def test_output_sorted_and_urls() -> None:
    chembl = FakeChembl(
        {"C1": mol("Bdrug"), "C2": mol("Adrug")},
        [mech("C1", "T1"), mech("C2", "T1")],
        {"C1": [ind("Multiple Sclerosis", 4), ind("Myasthenia Gravis", 4)],
         "C2": [ind("Multiple Sclerosis", 4)]},
    )  # fmt: skip
    mappings = {"bdrug": mapping("bdrug", "C1", ("X",))}
    fda = FakeFda({"bdrug": [label("SETB", "Treats multiple sclerosis.")]})
    overrides = [hand("add", "Adrug", row_id="a", source_url="https://hand/a")]
    items, _ = run([row("b", ("X",)), row("a", ("X",))], mappings, chembl, fda, overrides)
    assert [(a.row_id, a.disease, a.drug) for a in items] == [
        ("a", "MG", "bdrug"),
        ("a", "MS", "adrug"),
        ("a", "MS", "bdrug"),
        ("b", "MG", "bdrug"),
        ("b", "MS", "adrug"),
        ("b", "MS", "bdrug"),
    ]
    urls = {(a.row_id, a.disease, a.drug): a.url for a in items}
    assert urls[("a", "MS", "adrug")] == "https://hand/a"
    assert (
        urls[("a", "MS", "bdrug")] == "https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=SETB"
    )
    assert urls[("a", "MG", "bdrug")] == "https://www.ebi.ac.uk/chembl/compound_report_card/C1/"


def test_fetch_script_help_exits_zero() -> None:
    script = Path(__file__).resolve().parents[2] / "scripts" / "fetch_approvals.py"
    done = subprocess.run(
        [sys.executable, str(script), "--help"], check=False, capture_output=True, text=True
    )
    assert done.returncode == 0
    assert "--record" in done.stdout
