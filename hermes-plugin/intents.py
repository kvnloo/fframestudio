"""Canonical intent integration. This module never decides or writes approvals."""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

REVIEW = {
    "available": False,
    "reason": "Canonical OMP review cannot open an existing factory proposal in this plugin's store. No review-existing API is configured.",
}
PROPOSAL_UNAVAILABLE = (
    "AODL machine proposals unavailable: canonical IntentService prepare uses ingestUser "
    "and omp-root-user-history provenance; it has no authenticated machine-proposal source. "
    "No pending contract or OMP input receipt was fabricated."
)


def identity(value, name):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", value) or value in {".", ".."}:
        raise ValueError(f"Canonical approval requires a valid {name}")
    return value


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(value).hexdigest()


def action_scope(directory: Path, action: str, session_id: str):
    identity(session_id, "session_id")
    if action not in {"render", "review"}:
        raise ValueError("Unsupported factory action")
    directory = directory.resolve()
    workflow = directory / "workflow_api.json"
    # Hash bytes, not mtimes: replacing a workflow or result invalidates approval.
    state = {name: digest((directory / name).read_bytes()) if (directory / name).exists() else None
             for name in ("render.json", "result.json", "conditioning-manifest.json", "compare-sheet.png")}
    return {"action": action, "run": directory.name, "run_dir": str(directory), "session_id": session_id,
            "workflowHash": digest(workflow.read_bytes()), "stateHash": digest(encoded(state).encode())}


def target(scope):
    return "factory-action:" + encoded(scope)


def source_text(scope):
    return "Factory machine action proposal, not human input\n" + encoded(scope)


class LocalEvidence:
    """No inference or external retrieval for a literal, file-bound action proposal."""
    async def retrieve(self, *args):
        return {"records": [], "sources": [{"source": "factory-local-action", "status": "unavailable"}], "latency_ms": 0}


async def machine_proposal(request):
    # The canonical compiler hard-codes user provenance before calling this adapter.
    # Refuse before finish persists a false pending document. Do not patch the bridge,
    # substitute a validator or mint installed-extension receipts to get around it.
    raise ValueError(PROPOSAL_UNAVAILABLE)


def create_service(data_dir: Path):
    try:
        from z0int.intent_service import IntentService
        import aodl_contract
    except ImportError as error:
        raise ValueError("AODL unavailable: import z0int.intent_service and pinned aodl_contract via the configured Python environment/PYTHONPATH") from error
    if aodl_contract.CANON_VERSION != "aodl-canon-1":
        raise ValueError("AODL unavailable: pinned aodl-canon-1 validator required")
    return IntentService(root=data_dir / "aodl", retriever=LocalEvidence(), model=machine_proposal)


def read_document(path):
    try:
        doc = json.loads(path.read_text())
        if not isinstance(doc, dict):
            raise ValueError("Expected an object")
        return doc
    except (OSError, ValueError) as error:
        raise ValueError(f"Canonical approval unavailable or corrupt: {path}") from error


def write_metadata(path, value):
    """Plugin-owned references only, never canonical pending or approval files."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".factory-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(encoded(value) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


class ActionIntents:
    def __init__(self, data_dir):
        self.data_dir = Path(data_dir).expanduser().resolve()

    @contextmanager
    def lock(self):
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(self.data_dir / ".actions.lock", os.O_CREAT | os.O_RDWR, 0o600)
        with os.fdopen(fd, "a") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)

    def _reference_path(self, scope):
        return self.data_dir / "proposals" / scope["session_id"] / (digest(encoded(scope).encode()) + ".json")

    def _directory(self, scope):
        return self.data_dir / "aodl" / "intent" / scope["session_id"]

    def _check(self, service, doc, reference, scope, *, runtime=False):
        try:
            service.validator(doc)
            b = doc["plan"]["bindings"]
            approval = b["approval"]
            if b["sessionId"] != scope["session_id"]:
                raise ValueError("Canonical approval session mismatch")
            for key in ("session_id", "contract_id", "sourceHash", "contractHash"):
                if approval[key] != reference[key]:
                    raise ValueError("Canonical approval identity/hash mismatch")
            if (type(doc["revision"]) is not int or
                    (doc["revision"] < reference["revision"] if runtime else doc["revision"] != reference["revision"])):
                raise ValueError("Canonical approval revision mismatch")
            if (doc["provenance"]["sourceHash"] != reference["sourceHash"] or
                    asyncio.run(service.bridge({"op": "hash", "doc": doc})) != reference["contractHash"]):
                raise ValueError("Canonical approval source/contract hash mismatch")
            if b["compiler"]["model_id"] != reference["model_id"]:
                raise ValueError("Canonical proposal model identity mismatch")
            sources = b["sources"]
            if set(sources) != {reference["entry_id"]} or sources[reference["entry_id"]]["texts"] != [source_text(scope)]:
                raise ValueError("Canonical proposal exact source mismatch")
            tasks = [b[n["id"]] for n in doc["intentGraph"]["nodes"] if n["kind"] == "task"]
            if len(tasks) != 1 or tasks[0]["target"] != target(scope) or tasks[0]["executor"] != "factory":
                raise ValueError("Canonical proposal action/run/workflow scope mismatch")
            if tasks[0]["status"] != "open":
                raise ValueError("Canonical proposal task is no longer open")
            return approval
        except (KeyError, TypeError, IndexError) as error:
            raise ValueError("Canonical approval document is malformed") from error

    def _row(self, reference, status):
        scope = reference["scope"]
        return {"run": scope["run"], "action": scope["action"],
                "title": ("Review " if scope["action"] == "review" else "Render ") + scope["run"],
                **{key: reference[key] for key in ("contract_id", "session_id", "revision", "sourceHash", "contractHash")},
                "status": status, "review": dict(REVIEW)}

    def ensure(self, scope):
        with self.lock():
            service = create_service(self.data_dir)
            path = self._reference_path(scope)
            if path.exists():
                reference = read_document(path)
                if reference.get("scope") != scope:
                    raise ValueError("Canonical proposal reference scope mismatch")
                directory = self._directory(scope)
                contract = identity(reference.get("contract_id"), "contract_id") + ".json"
                approved = directory / contract
                doc = read_document(approved if approved.exists() else directory / ".pending" / contract)
                approval = self._check(service, doc, reference, scope)
                if approval["status"] not in {"pending", "approved", "rejected"}:
                    raise ValueError("Unknown canonical proposal status")
                if approval["status"] == "approved":
                    self._approved(service, reference, scope)
                return self._row(reference, approval["status"])
            fingerprint = digest(encoded(scope).encode())
            entry = "factory-" + fingerprint[:24]
            try:
                result = asyncio.run(service.reconcile({"session_id": scope["session_id"], "entry_id": entry,
                                                        "text": source_text(scope), "recent_user_msgs": []}))
            except (OSError, RuntimeError) as error:
                raise ValueError("AODL compiler unavailable; no action is authorized") from error
            reference = {key: result[key] for key in ("contract_id", "revision", "sourceHash", "contractHash", "model_id")}
            reference.update(scope=scope, session_id=scope["session_id"], entry_id=entry)
            approval = self._check(service, result["contract"], reference, scope)
            if approval["status"] != "pending":
                raise ValueError("Canonical reconciliation did not return a pending proposal")
            write_metadata(path, reference)
            return self._row(reference, "pending")

    def _approved(self, service, reference, scope):
        directory = self._directory(scope)
        name = identity(reference.get("contract_id"), "contract_id") + ".json"
        # A .pending copy, even one saying approved, is never authority.
        root = read_document(directory / name)
        approval = self._check(service, root, reference, scope)
        if approval["status"] != "approved" or approval.get("approved_by") != "kevin":
            raise ValueError("Matching canonical Kevin approval required")
        try:
            approved_at = datetime.fromisoformat(approval["approved_at"])
            asked_at = datetime.fromisoformat(root["plan"]["bindings"]["sources"][reference["entry_id"]]["timestamp"])
            if not asked_at <= approved_at <= datetime.now(timezone.utc):
                raise ValueError("Canonical approval timestamp is invalid")
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("Canonical approval timestamp is invalid") from error
        current = read_document(directory / ".pending" / "current.json")
        if current.get("contract_id") != reference["contract_id"]:
            raise ValueError("Canonical approval was superseded")
        runtime = directory / "runtime" / name
        if runtime.exists() or runtime.is_symlink():
            doc = read_document(runtime)
            runtime_approval = self._check(service, doc, reference, scope, runtime=True)
            if runtime_approval != approval:
                raise ValueError("Runtime canonical approval mismatch")
        return approval

    @contextmanager
    def execution(self, scope, contract_id):
        with self.lock():
            path = self._reference_path(scope)
            if not path.is_file():
                raise ValueError("Matching canonical approval required for this action/run/session/workflow state")
            reference = read_document(path)
            if reference.get("scope") != scope or reference.get("contract_id") != contract_id:
                raise ValueError("Matching canonical approval identity/scope required")
            self._approved(create_service(self.data_dir), reference, scope)
            # Durable at-most-once claim before spawning. A crash or failed launch does
            # not release approval for replay. This is not an execution-success receipt.
            claim = self.data_dir / "claims" / (digest((scope["session_id"] + ":" + contract_id).encode()) + ".json")
            claim.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                fd = os.open(claim, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError as error:
                raise ValueError("Canonical approval already claimed; automatic repeat execution is blocked") from error
            with os.fdopen(fd, "w") as stream:
                stream.write(encoded({"contract_id": contract_id, "scope": scope, "status": "claimed-not-confirmed"}) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            yield
