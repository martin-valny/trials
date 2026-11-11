"""Shared fixtures: moto DynamoDB with the three tables mirroring template.yaml."""

from collections.abc import Iterator

import boto3
import pytest
from moto import mock_aws

from diligence.config import AgentConfig, load_config


@pytest.fixture(autouse=True)
def _fake_aws_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        monkeypatch.setenv(name, "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-central-1")


@pytest.fixture
def cfg() -> AgentConfig:
    return load_config()


@pytest.fixture
def ddb(cfg: AgentConfig) -> Iterator[object]:
    with mock_aws():
        resource = boto3.resource("dynamodb", region_name=cfg.region)
        for name in (cfg.tables.runs, cfg.tables.limits, cfg.tables.flags):
            resource.create_table(
                TableName=name,
                KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
                AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
                BillingMode="PAY_PER_REQUEST",
            )
        yield resource
