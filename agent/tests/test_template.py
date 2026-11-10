"""template.yaml: structural assertions (pure Python) and `sam validate --lint` when available."""

import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

AGENT = Path(__file__).resolve().parents[1]
TEMPLATE = AGENT / "template.yaml"


class _Loader(yaml.SafeLoader):
    """Tolerates CloudFormation short tags (!Ref, !Sub, !GetAtt, ...) as {"Fn::X": value}."""


def _tag(loader: yaml.Loader, suffix: str, node: yaml.Node) -> Any:
    value: Any
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node, deep=True)
    else:
        value = loader.construct_mapping(node, deep=True)  # type: ignore[arg-type]
    return {suffix if suffix == "Ref" else f"Fn::{suffix}": value}


_Loader.add_multi_constructor("!", _tag)


@pytest.fixture(scope="module")
def tpl() -> dict[str, Any]:
    data: dict[str, Any] = yaml.load(TEMPLATE.read_text(), Loader=_Loader)
    return data


def resources(tpl: dict[str, Any], kind: str) -> dict[str, Any]:
    return {k: v for k, v in tpl["Resources"].items() if v["Type"] == kind}


def fn(tpl: dict[str, Any]) -> dict[str, Any]:
    (found,) = resources(tpl, "AWS::Serverless::Function").values()
    return found  # type: ignore[no-any-return]


def test_transform_and_parameters(tpl: dict[str, Any]) -> None:
    assert tpl["Transform"] == "AWS::Serverless-2016-10-31"
    params = tpl["Parameters"]
    assert set(params) >= {
        "AllowedOrigins",
        "IpSalt",
        "BedrockModelArns",
        "SiteBaseUrl",
        "ReservedConcurrency",
    }
    assert params["AllowedOrigins"]["Type"] == "CommaDelimitedList"
    assert params["IpSalt"]["NoEcho"] is True
    assert params["BedrockModelArns"]["Type"] == "CommaDelimitedList"
    assert "Default" not in params["IpSalt"]  # a salt is never committed


def test_function_shape(tpl: dict[str, Any]) -> None:
    props = fn(tpl)["Properties"]
    assert (
        props["Runtime"] == "python3.12" and props["Handler"] == "diligence.handler.lambda_handler"
    )
    assert props["Timeout"] == 240 and props["MemorySize"] == 512
    assert fn(tpl)["Metadata"]["BuildMethod"] == "makefile"


def test_timeouts_agree(tpl: dict[str, Any]) -> None:
    """I5/R40: Lambda Timeout 240 s; a run is stale only after 270 s, so a run that starts
    within START_DEADLINE_S of its creation always ends before it can be called stale."""
    from diligence.store import RUN_TIMEOUT_S, STALE_AFTER_S, START_DEADLINE_S

    timeout = fn(tpl)["Properties"]["Timeout"]
    assert RUN_TIMEOUT_S == timeout == 240 and STALE_AFTER_S == 270
    assert START_DEADLINE_S + RUN_TIMEOUT_S <= STALE_AFTER_S


def test_reserved_concurrency_is_a_parameter(tpl: dict[str, Any]) -> None:
    """I9/R44: default 2; 0 leaves the function unreserved (new accounts' quota of 10)."""
    param = tpl["Parameters"]["ReservedConcurrency"]
    assert param["Default"] == 2 and param["MinValue"] == 0
    assert tpl["Conditions"]["ReserveConcurrency"] == {
        "Fn::Not": [{"Fn::Equals": [{"Ref": "ReservedConcurrency"}, 0]}]
    }
    assert fn(tpl)["Properties"]["ReservedConcurrentExecutions"] == {
        "Fn::If": ["ReserveConcurrency", {"Ref": "ReservedConcurrency"}, {"Ref": "AWS::NoValue"}]
    }


def test_async_invoke_never_retries(tpl: dict[str, Any]) -> None:
    cfg = fn(tpl)["Properties"]["EventInvokeConfig"]
    assert cfg["MaximumRetryAttempts"] == 0 and cfg["MaximumEventAgeInSeconds"] <= 60


def test_explicit_public_url_permission(tpl: dict[str, Any]) -> None:
    (perm,) = resources(tpl, "AWS::Lambda::Permission").values()
    props = perm["Properties"]
    assert props["Action"] == "lambda:InvokeFunction" and props["Principal"] == "*"
    assert props["InvokedViaFunctionUrl"] is True
    assert props["FunctionName"] == {"Ref": "DiligenceFunction"}


def test_function_url_and_cors_use_the_parameter(tpl: dict[str, Any]) -> None:
    url = fn(tpl)["Properties"]["FunctionUrlConfig"]
    assert url["AuthType"] == "NONE"
    cors = url["Cors"]
    assert cors["AllowOrigins"] == {"Ref": "AllowedOrigins"}  # R46: a list parameter
    assert sorted(cors["AllowMethods"]) == ["GET", "POST"]
    assert [h.lower() for h in cors["AllowHeaders"]] == ["content-type"]


def test_environment(tpl: dict[str, Any]) -> None:
    env = fn(tpl)["Properties"]["Environment"]["Variables"]
    assert env["IP_SALT"] == {"Ref": "IpSalt"}
    assert env["ALLOWED_ORIGIN"] == {"Fn::Join": [",", {"Ref": "AllowedOrigins"}]}
    assert env["SITE_BASE_URL"] == {"Ref": "SiteBaseUrl"}
    assert env["DILIGENCE_CONFIG"] == "/var/task/config.yaml"
    assert {"RUNS_TABLE", "LIMITS_TABLE", "FLAGS_TABLE"} <= set(env)


def test_three_on_demand_tables_limits_has_ttl(tpl: dict[str, Any]) -> None:
    tables = resources(tpl, "AWS::DynamoDB::Table")
    assert set(tables) == {"RunsTable", "LimitsTable", "FlagsTable"}
    for t in tables.values():
        assert t["Properties"]["BillingMode"] == "PAY_PER_REQUEST"
        assert t["Properties"]["KeySchema"] == [{"AttributeName": "pk", "KeyType": "HASH"}]
    ttl = tables["LimitsTable"]["Properties"]["TimeToLiveSpecification"]
    assert ttl == {"AttributeName": "ttl", "Enabled": True}


def test_policies_are_least_privilege(tpl: dict[str, Any]) -> None:
    policies = fn(tpl)["Properties"]["Policies"]
    crud = [p["DynamoDBCrudPolicy"]["TableName"] for p in policies if "DynamoDBCrudPolicy" in p]
    assert sorted(c["Ref"] for c in crud) == ["FlagsTable", "LimitsTable", "RunsTable"]
    statements = [s for p in policies if "Statement" in p for s in p["Statement"]]
    bedrock = next(s for s in statements if "bedrock:InvokeModel" in s["Action"])
    assert bedrock["Action"] == ["bedrock:InvokeModel"]
    assert bedrock["Resource"] == {"Ref": "BedrockModelArns"}
    invoke = next(s for s in statements if "lambda:InvokeFunction" in s["Action"])
    resource = invoke["Resource"]["Fn::Sub"]
    assert resource.startswith("arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:")
    assert "*" not in resource
    assert len(statements) == 2


def test_log_group_and_outputs(tpl: dict[str, Any]) -> None:
    (group,) = resources(tpl, "AWS::Logs::LogGroup").values()
    assert group["Properties"]["RetentionInDays"] == 14
    assert "FunctionUrl" in tpl["Outputs"]


def test_no_account_ids_or_secrets_committed() -> None:
    import re

    text = TEMPLATE.read_text()
    assert not re.search(r"\b\d{12}\b", text)
    assert "AKIA" not in text


@pytest.mark.skipif(shutil.which("sam") is None, reason="AWS SAM CLI is not installed")
def test_sam_validate_lint() -> None:
    out = subprocess.run(
        ["sam", "validate", "--lint", "--template-file", str(TEMPLATE), "--region", "eu-central-1"],
        capture_output=True,
        text=True,
        cwd=AGENT,
        check=False,
    )
    assert out.returncode == 0, out.stdout + out.stderr


def test_lambda_package_pins_the_locked_boto3() -> None:
    """Minor 9: the package carries the tested botocore instead of the runtime's bundled one."""
    import tomllib

    lock = tomllib.loads((AGENT / "uv.lock").read_text())
    locked = {p["name"]: p["version"] for p in lock["package"]}
    reqs = dict(
        line.split("==")
        for line in (AGENT / "requirements-lambda.txt").read_text().splitlines()
        if line and not line.startswith("#")
    )
    for name in ("boto3", "botocore", "httpx", "pydantic", "pyyaml"):
        assert reqs[name] == locked[name]


def test_site_build_passes_the_diligence_url() -> None:
    """I8/R43: the Pages build reads the endpoint from the DILIGENCE_URL repo variable."""
    daily = yaml.safe_load((AGENT.parent / ".github" / "workflows" / "daily.yml").read_text())
    steps = [s for job in daily["jobs"].values() for s in job.get("steps", [])]
    (build,) = [s for s in steps if s.get("name") == "Build site"]
    assert build["env"]["VITE_DILIGENCE_URL"] == "${{ vars.DILIGENCE_URL }}"


def test_sam_outputs_are_git_ignored() -> None:
    """Minor 6: sam build output and the guided-deploy config never get committed."""
    ignored = (AGENT.parent / ".gitignore").read_text().splitlines()
    assert "agent/.aws-sam/" in ignored and "agent/samconfig.toml" in ignored
