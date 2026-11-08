"""Draft pipeline-figure data for the brainstorm mockups (throwaway)."""
import json, collections as C, sys, re

ROOT = "/Users/martin.valny/Desktop/trials/web/dist/data/"
d = json.load(open(ROOT + "explorer.json"))
tj = {x["nct_id"]: x for x in json.load(open(ROOT + "trials.json"))["trials"]}
di = d["drug_index"]

# family, row label, gene/sub label, mechanism classes
ROWS = [
    ("B-cell depletion", "CD20", "MS4A1 · antibodies", ["anti-CD20"]),
    ("B-cell depletion", "CD19", "CD19 · antibodies", ["anti-CD19"]),
    ("B-cell depletion", "BAFF / APRIL", "TNFSF13B · TNFSF13", ["anti-BAFF", "anti-APRIL"]),
    ("Cell therapy", "CD19 CAR-T", "engineered T cells", ["CD19 CAR-T"]),
    ("Cell therapy", "BCMA CAR-T", "engineered T cells", ["BCMA CAR-T"]),
    ("Cell therapy", "CD20 CAR-T", "engineered T cells", ["CD20 CAR-T"]),
    ("IgG and complement", "FcRn", "FCGRT · IgG recycling", ["anti-FcRn"]),
    ("IgG and complement", "C5", "terminal complement", ["anti-C5"]),
    ("IgG and complement", "C1s / C2", "classical pathway", ["anti-C1s", "anti-C2"]),
    ("Kinases", "BTK", "BTK · small molecules", ["BTK inhibitor"]),
    ("Cytokines and co-stimulation", "IL-6 receptor", "IL6R", ["anti-IL-6R"]),
    ("Cytokines and co-stimulation", "CD40L / CD3", "CD40LG · CD3E", ["anti-CD40L", "anti-CD3"]),
    ("Lymphocyte trafficking", "S1P receptor", "S1PR1 · small molecules", ["S1P receptor modulator"]),
    ("Lymphocyte trafficking", "α4-integrin", "ITGA4", ["anti-α4-integrin"]),
    ("Broad immune modulation", "Fumarates", "Nrf2 / KEAP1", ["KEAP1 inhibitor"]),
    ("Broad immune modulation", "DHODH", "DHODH · teriflunomide", ["DHODH inhibitor"]),
    ("Broad immune modulation", "CD52", "CD52 · alemtuzumab", ["anti-CD52"]),
    ("Broad immune modulation", "Interferon-β", "IFNAR1/2", ["IFN-α/β receptor modulator"]),
    ("Repair and protection", "LINGO-1 / RGMa", "remyelination", ["anti-LINGO-1", "anti-RGMa"]),
    ("Repair and protection", "Syncytin-1", "HERV-W env", ["anti-syncytin-1"]),
]
DRUG_ROWS = {"cladribine": "Cladribine", "mavenclad®": "Cladribine", "clemastine": "Clemastine", "clemastine fumarate": "Clemastine"}
EXTRA_ROWS = [("Broad immune modulation", "Cladribine", "purine analogue", []), ("Repair and protection", "Clemastine", "M1 / H1 · remyelination", [])]
BACKGROUND = {"methylprednisolone", "prednisone", "prednisolone", "cyclophosphamide", "fludarabine", "cetirizine", "acetaminophen",
              "paracetamol", "diphenhydramine", "acyclovir", "standard lymphodepletion regimen", "cyclophosphamide and fludarabine",
              "fludarabine for", "chemotherapy: fludarabine", "dexamethasone", "antihistamine", "ceterizine"}

PARENT = [
    (r"roche|genentech", "Roche"), (r"novartis", "Novartis"), (r"merck kgaa|emd serono|merck healthcare kgaa|merck serono", "Merck KGaA"),
    (r"alexion|astrazeneca", "AstraZeneca"), (r"biogen", "Biogen"), (r"sanofi|genzyme", "Sanofi"), (r"teva", "Teva"), (r"argenx", "argenx"),
    (r"glaxo|gsk", "GSK"), (r"ucb", "UCB"), (r"tg therapeutics", "TG Therapeutics"), (r"janssen|johnson", "J&J"), (r"immunovant", "Immunovant"),
    (r"celgene|bristol", "BMS"), (r"actelion", "J&J"), (r"tanabe", "Mitsubishi Tanabe"), (r"horizon|amgen", "Amgen"), (r"viela", "Amgen"),
    (r"kyverna", "Kyverna"), (r"cabaletta", "Cabaletta Bio"), (r"harbour biomed", "Harbour BioMed"), (r"chugai", "Roche"), (r"bayer", "Bayer"),
    (r"pfizer", "Pfizer"), (r"regeneron", "Regeneron"), (r"ra pharma", "UCB"), (r"vertex", "Vertex"), (r"cartesian", "Cartesian"),
    (r"remegen", "RemeGen"), (r"geneuro", "GeNeuro"), (r"abbvie", "AbbVie"), (r"takeda", "Takeda"), (r"lilly", "Lilly"),
]
ACADEMIC = re.compile(r"universit|hospital|college|institut|clinic|foundation|center|centre|school|nih|national|ministry|council|society|charit|hopitaux|assistance|medical|research", re.I)


def parent(s):
    for pat, name in PARENT:
        if re.search(pat, s or "", re.I):
            return name, True
    return s, not bool(ACADEMIC.search(s or ""))


row_of_class = {c: r[1] for r in ROWS for c in r[3]}
allrows = ROWS + EXTRA_ROWS
COL = {"EARLY_PHASE1": 1, "PHASE1": 1, "PHASE2": 2, "PHASE3": 3, "PHASE4": 4}
STATE = {"succeeded": "adv", "running": "run", "stopped": "stop", "completed_unknown": "fin", "unknown": "unk"}
DZ = {"Multiple sclerosis": "MS", "Myasthenia gravis": "MG", "NMOSD": "NMOSD", "CIDP": "CIDP", "Autoimmune encephalitis": "AE", "MOGAD": "MOGAD"}

marks = C.defaultdict(list)
for x in d["trials"]:
    if "targeted" not in x["approaches"] or x["phase"] not in COL:
        continue
    drugs = [dr for dr in x["drugs"] if dr not in BACKGROUND] or x["drugs"]
    rows = {}
    for dr in drugs:
        if dr in DRUG_ROWS:
            rows.setdefault(DRUG_ROWS[dr], dr); continue
        for m in di.get(dr, {}).get("mechanisms", []):
            if m in row_of_class:
                rows.setdefault(row_of_class[m], dr)
    t = tj[x["nct_id"]]
    co, ind = parent(x["lead_sponsor"])
    sc = json.load(open(ROOT + f'trials/{x["nct_id"]}.json')).get("sponsor_class")
    ind = (sc == "INDUSTRY") or (ind and co != x["lead_sponsor"])
    ph = t["phases"] or []
    comb = "1/2" if ph == ["PHASE1", "PHASE2"] else "2/3" if ph == ["PHASE2", "PHASE3"] else ""
    co = re.sub(r",? (co\.,? ?ltd\.?|ltd\.?|llc|inc\.?|gmbh|s\.?a\.?|ag|plc|corporation|pharmaceuticals?|biomedicine)\b\.?", "", co, flags=re.I).strip(" ,") if ind else co
    co = re.sub(r",? a gilead company", "", co, flags=re.I)
    for r, lead in rows.items():
        marks[r].append(dict(n=x["nct_id"], p=COL[x["phase"]], s=STATE[x["outcome"]], y=x["start_year"], c=co, i=ind,
                             dr=lead, dz=[DZ[c] for c in x["condition_labels"]], cb=comb, t=x["title"][:110], y2=x["end_year"], e=x["end_estimated"]))

out = []
for fam, label, sub, _ in allrows:
    ms = sorted(marks[label], key=lambda m: (m["y"] or 0))
    out.append(dict(family=fam, label=label, sub=sub, marks=ms))
for r in out:
    print(f'{r["label"]:16} n={len(r["marks"]):3} run={sum(m["s"]=="run" for m in r["marks"]):3} adv={sum(m["s"]=="adv" for m in r["marks"]):2}',
          C.Counter(m["c"] for m in r["marks"] if m["i"]).most_common(4), file=sys.stderr)

# target page extras for CD20
cd = [m for r in out if r["label"] == "CD20" for m in r["marks"]]
why = {}
for m in cd:
    if m["s"] == "stop":
        why[m["n"]] = json.load(open(ROOT + f'trials/{m["n"]}.json')).get("why_stopped")
g = json.load(open(ROOT + "mechanisms.json"))
json.dump(dict(rows=out, why=why, asof="6 Nov 2026", total=len(d["trials"]),
               targeted=sum("targeted" in x["approaches"] for x in d["trials"])),
          open(sys.argv[1], "w"))
