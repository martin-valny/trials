"""DynamoDB access: runs (records, cache-key and latest pointers), daily quotas, flags.

Runs table (pk only):
  run#<id>                       record (JSON string), steps (list of JSON strings while running)
  key#<cache key>                pointer: run_id, status, started_at; created with a conditional put
  latest#<target>#<disease>      pointer to the latest *done* run
Limits table: ip#<hash>#<day> and global#<day> counters, expiring through the `ttl` attribute.
Records are stored as JSON strings so floats never meet DynamoDB's Decimal rules.
"""

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import boto3
from botocore.exceptions import ClientError

from diligence.config import AgentConfig
from diligence.types import RunRecord, Step

STALE_AFTER_S = 150
TTL_DAYS = 3
FLAGS_PER_IP_PER_DAY = 20
FLAGS_GLOBAL_PER_DAY = 500
_STAMP = "%Y-%m-%dT%H:%M:%SZ"

Quota = Literal["ok", "ip", "global"]


def cache_key(target: str, disease: str, fingerprint: str, agent_version: str) -> str:
    blob = json.dumps([target, disease, fingerprint, agent_version]).encode()
    return hashlib.sha256(blob).hexdigest()


@dataclass(frozen=True)
class NewRun:
    target: str
    disease: str
    fingerprint: str
    started_at: str


def _failed(exc: ClientError, code: str) -> bool:
    return bool(exc.response.get("Error", {}).get("Code") == code)


_CONDITION_FAILED = "ConditionalCheckFailedException"


class Store:
    def __init__(
        self,
        cfg: AgentConfig,
        resource: Any | None = None,
        now: Any = lambda: datetime.now(UTC),
    ) -> None:
        self.cfg = cfg
        self._resource = resource
        self._now = now

    # -- tables (boto3 built lazily so importing never needs AWS) ------------------------------

    def _table(self, name: str) -> Any:
        if self._resource is None:
            self._resource = boto3.resource("dynamodb", region_name=self.cfg.region)
        return self._resource.Table(name)

    @property
    def _runs(self) -> Any:
        return self._table(self.cfg.tables.runs)

    @property
    def _limits(self) -> Any:
        return self._table(self.cfg.tables.limits)

    @property
    def _flags(self) -> Any:
        return self._table(self.cfg.tables.flags)

    # -- runs ------------------------------------------------------------------------------------

    def _item(self, pk: str) -> dict[str, Any] | None:
        item = self._runs.get_item(Key={"pk": pk}, ConsistentRead=True).get("Item")
        return item  # type: ignore[no-any-return]

    def get_run(self, run_id: str) -> RunRecord | None:
        item = self._item(f"run#{run_id}")
        if item is None:
            return None
        rec = RunRecord.model_validate_json(item["record"])
        if rec.status == "running" and item.get("steps"):
            rec = rec.model_copy(
                update={"steps": [Step.model_validate_json(s) for s in item["steps"]]}
            )
        return rec

    def get_cached(self, key: str) -> RunRecord | None:
        pointer = self._item(f"key#{key}")
        if pointer is None or pointer.get("status") != "done":
            return None
        return self.get_run(pointer["run_id"])

    def latest_for(self, target: str, disease: str) -> RunRecord | None:
        pointer = self._item(f"latest#{target}#{disease}")
        return self.get_run(pointer["run_id"]) if pointer else None

    def _is_stale(self, pointer: dict[str, Any]) -> bool:
        age = self._now().timestamp() - float(pointer.get("started_ts", 0))
        return bool(age > STALE_AFTER_S)

    def running_for(self, key: str) -> str | None:
        pointer = self._item(f"key#{key}")
        if pointer and pointer.get("status") == "running" and not self._is_stale(pointer):
            return str(pointer["run_id"])
        return None

    def create_run(self, key: str, req: NewRun, replace_finished: bool = False) -> tuple[str, bool]:
        """Create a run unless one is in flight for the key.

        Returns (run_id, created). The pointer put is conditional, so concurrent callers all get
        the winner's id. A finished (done/failed) or stale pointer is replaced when
        `replace_finished` is set or the old run failed; the replace is conditional on the old
        run id, so concurrent force-reruns still produce one run.
        """
        run_id = uuid.uuid4().hex
        record = RunRecord(
            run_id=run_id,
            target=req.target,
            disease=req.disease,
            fingerprint=req.fingerprint,
            agent_version=self.cfg.agent_version,
            status="running",
            started_at=req.started_at,
        )
        self._runs.put_item(
            Item={"pk": f"run#{run_id}", "key": key, "record": record.model_dump_json()}
        )
        pointer = {
            "pk": f"key#{key}",
            "run_id": run_id,
            "status": "running",
            "started_ts": int(self._now().timestamp()),
        }
        try:
            self._runs.put_item(Item=pointer, ConditionExpression="attribute_not_exists(pk)")
            return run_id, True
        except ClientError as exc:
            if not _failed(exc, _CONDITION_FAILED):
                self._runs.delete_item(Key={"pk": f"run#{run_id}"})
                raise
        existing = self._item(f"key#{key}")
        if existing is None:  # pointer vanished between the put and the read; try once more
            self._runs.delete_item(Key={"pk": f"run#{run_id}"})
            return self.create_run(key, req, replace_finished)
        replaceable = (
            existing["status"] == "failed"
            or (existing["status"] == "done" and replace_finished)
            or (existing["status"] == "running" and self._is_stale(existing))
        )
        if replaceable:
            try:
                self._runs.put_item(
                    Item=pointer,
                    ConditionExpression="run_id = :old",
                    ExpressionAttributeValues={":old": existing["run_id"]},
                )
                return run_id, True
            except ClientError as exc:
                if not _failed(exc, _CONDITION_FAILED):
                    raise
                existing = self._item(f"key#{key}") or existing
        self._runs.delete_item(Key={"pk": f"run#{run_id}"})
        return str(existing["run_id"]), False

    def claim_execution(self, run_id: str) -> bool:
        """Mark a run as executing; only the first caller wins (async retries must not re-run)."""
        try:
            self._runs.update_item(
                Key={"pk": f"run#{run_id}"},
                UpdateExpression="SET executing_at = :t",
                ConditionExpression="attribute_exists(pk) AND attribute_not_exists(executing_at)",
                ExpressionAttributeValues={":t": int(self._now().timestamp())},
            )
            return True
        except ClientError as exc:
            if _failed(exc, _CONDITION_FAILED):
                return False
            raise

    def append_step(self, run_id: str, step: Step) -> None:
        self._runs.update_item(
            Key={"pk": f"run#{run_id}"},
            UpdateExpression="SET steps = list_append(if_not_exists(steps, :empty), :s)",
            ExpressionAttributeValues={":empty": [], ":s": [step.model_dump_json()]},
        )

    def finish(self, run_id: str, record: RunRecord) -> None:
        item = self._item(f"run#{run_id}")
        key = item["key"] if item else None
        self._runs.put_item(
            Item={"pk": f"run#{run_id}", "key": key or "", "record": record.model_dump_json()}
        )
        if key:
            try:
                self._runs.update_item(
                    Key={"pk": f"key#{key}"},
                    UpdateExpression="SET #s = :s",
                    ConditionExpression="run_id = :r",
                    ExpressionAttributeNames={"#s": "status"},
                    ExpressionAttributeValues={":s": record.status, ":r": run_id},
                )
            except ClientError as exc:  # the pointer already moved on to a newer run
                if not _failed(exc, _CONDITION_FAILED):
                    raise
        if record.status == "done":
            self._runs.put_item(
                Item={"pk": f"latest#{record.target}#{record.disease}", "run_id": run_id}
            )

    # -- quotas ----------------------------------------------------------------------------------

    def _ttl(self, day: str) -> int:
        end = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=UTC) + timedelta(days=TTL_DAYS)
        return int(end.timestamp())

    def _bump(self, pk: str, day: str, limit: int) -> bool:
        try:
            self._limits.update_item(
                Key={"pk": pk},
                UpdateExpression="ADD n :one SET #t = :ttl",
                ConditionExpression="attribute_not_exists(n) OR n < :limit",
                ExpressionAttributeNames={"#t": "ttl"},
                ExpressionAttributeValues={":one": 1, ":limit": limit, ":ttl": self._ttl(day)},
            )
            return True
        except ClientError as exc:
            if _failed(exc, _CONDITION_FAILED):
                return False
            raise

    def _drop(self, pk: str) -> None:
        self._limits.update_item(
            Key={"pk": pk},
            UpdateExpression="ADD n :minus",
            ConditionExpression="n > :zero",
            ExpressionAttributeValues={":minus": -1, ":zero": 0},
        )

    def _take(
        self, ip_pk: str, global_pk: str, day: str, ip_limit: int, global_limit: int
    ) -> Quota:
        if not self._bump(ip_pk, day, ip_limit):
            return "ip"
        if not self._bump(global_pk, day, global_limit):
            self._drop(ip_pk)
            return "global"
        return "ok"

    def take_quota(self, ip_hash: str, day: str) -> Quota:
        daily = self.cfg.daily
        return self._take(
            f"ip#{ip_hash}#{day}",
            f"global#{day}",
            day,
            daily.per_ip_runs_per_day,
            daily.global_runs_per_day,
        )

    def take_flag_quota(self, ip_hash: str, day: str) -> Quota:
        return self._take(
            f"ip#{ip_hash}#flags#{day}",
            f"global#flags#{day}",
            day,
            FLAGS_PER_IP_PER_DAY,
            FLAGS_GLOBAL_PER_DAY,
        )

    def refund_quota(self, ip_hash: str, day: str) -> None:
        """Give back a slot taken for a run that turned out not to be needed."""
        for pk in (f"ip#{ip_hash}#{day}", f"global#{day}"):
            try:
                self._drop(pk)
            except ClientError as exc:
                if not _failed(exc, _CONDITION_FAILED):
                    raise

    # -- flags -----------------------------------------------------------------------------------

    def add_flag(self, run_id: str, sentence_id: str, reason: str) -> None:
        self._flags.put_item(
            Item={
                "pk": uuid.uuid4().hex,
                "run_id": run_id,
                "sentence_id": sentence_id,
                "reason": reason,
                "created_at": self._now().strftime(_STAMP),
            }
        )
