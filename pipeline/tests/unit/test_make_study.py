from conftest import DELETE, make_study


def test_defaults() -> None:
    s = make_study()
    ps = s["protocolSection"]
    assert ps["identificationModule"]["nctId"] == "NCT00000001"
    assert ps["designModule"]["studyType"] == "INTERVENTIONAL"
    assert ps["statusModule"]["lastUpdatePostDateStruct"]["date"]


def test_nct_id_and_dotted_override() -> None:
    s = make_study("NCT12345678", **{"statusModule.overallStatus": "TERMINATED"})
    ps = s["protocolSection"]
    assert ps["identificationModule"]["nctId"] == "NCT12345678"
    assert ps["statusModule"]["overallStatus"] == "TERMINATED"
    assert ps["statusModule"]["startDateStruct"]["date"] == "2024-01"


def test_nested_override_and_new_key() -> None:
    s = make_study(**{"designModule.enrollmentInfo.count": 5, "statusModule.whyStopped": "Funding"})
    ps = s["protocolSection"]
    assert ps["designModule"]["enrollmentInfo"] == {"count": 5, "type": "ESTIMATED"}
    assert ps["statusModule"]["whyStopped"] == "Funding"


def test_delete_sentinel() -> None:
    s = make_study(**{"statusModule.primaryCompletionDateStruct": DELETE})
    assert "primaryCompletionDateStruct" not in s["protocolSection"]["statusModule"]
    assert make_study.DELETE is DELETE  # type: ignore[attr-defined]


def test_calls_are_independent() -> None:
    a = make_study(**{"conditionsModule.conditions": ["X"]})
    b = make_study()
    assert b["protocolSection"]["conditionsModule"]["conditions"] == ["Multiple Sclerosis"]
    a["protocolSection"]["conditionsModule"]["conditions"].append("Y")
    assert make_study()["protocolSection"]["conditionsModule"]["conditions"] == [
        "Multiple Sclerosis"
    ]
