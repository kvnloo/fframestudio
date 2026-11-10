"""Synthetic fixtures only. Real IntentService, compiler, validator and decision API.

No installed OMP receipts or production approvals. Launchers are always stubbed.
"""
import asyncio
import copy
import json
from unittest.mock import Mock

import pytest

from test_core import core, factory


@pytest.fixture
def canonical(factory, tmp_path, monkeypatch):
    module = pytest.importorskip("z0int.intent_service")
    pytest.importorskip("aodl_contract")
    from factory_plugin import intents

    monkeypatch.setenv("FACTORY_DATA_DIR", str(tmp_path / "plugin-data"))

    class SyntheticEvidence:
        async def retrieve(self, *args):
            return {"records": [], "sources": [{"source": "synthetic-test", "status": "unavailable"}], "latency_ms": 0}

    async def synthetic_model(request):
        context = request["context"]
        scope = json.loads(context["text"].split("\n", 1)[1])
        decisions, tasks = [], []
        for entry, source in context["document"]["plan"]["bindings"]["sources"].items():
            for sentence in source["sentences"]:
                ref = {"entryId": entry, "sentenceId": sentence["id"]}
                decisions.append({**ref, "classification": "not-an-ask" if tasks else "add", "reason": "synthetic fixture"})
                if not tasks:
                    target = intents.target(scope)
                    tasks.append({**ref, "target": target, "interpretation": "SYNTHETIC TEST ONLY", "executor": "factory",
                                  "assumptions": [], "conflicts": [], "verifier": {"type": "human_review", "target": target}})
        return {"model_id": "factory/synthetic-test-only", "draft": {
            "classification": "new_ask", "sentences": decisions, "tasks": tasks,
            "assumptions": [], "amendments": [], "conflicts": [], "delegation_plan": []}}

    service = module.IntentService(root=tmp_path / "plugin-data" / "aodl",
                                   retriever=SyntheticEvidence(), model=synthetic_model)
    monkeypatch.setattr(intents, "create_service", lambda data_dir: service)
    launcher = Mock()
    monkeypatch.setattr(core, "Popen", launcher)
    store = intents.ActionIntents(tmp_path / "plugin-data")
    return intents, store, service, launcher


def propose(canonical, factory, action="render", session="sid"):
    intents, store, service, _ = canonical
    return store.ensure(intents.action_scope(factory / "shot-a", action, session))


def decide(canonical, row, approve=True):
    # Explicit synthetic decision in temporary fixture, never a production UI.
    request = {k: row[k] for k in ("session_id", "contract_id", "revision", "sourceHash", "contractHash")}
    return asyncio.run(canonical[2].decide(request, approve))


def test_pending_is_canonical_private_stable_across_restart(canonical, factory, monkeypatch):
    intents, store, service, launcher = canonical
    first = propose(canonical, factory)
    restarted = type(service)(root=service.root, retriever=service.retriever, model=service.model)
    monkeypatch.setattr(intents, "create_service", lambda data_dir: restarted)
    again = intents.ActionIntents(store.data_dir).ensure(intents.action_scope(factory / "shot-a", "render", "sid"))
    assert first == again
    path = service.root / "intent" / "sid" / ".pending" / (first["contract_id"] + ".json")
    doc = json.loads(path.read_text())
    assert doc["plan"]["bindings"]["approval"]["status"] == "pending"
    assert not path.stat().st_mode & 0o077
    assert not (path.parent.parent / path.name).exists()
    assert doc["plan"]["bindings"]["compiler"]["model_id"] == "factory/synthetic-test-only"
    assert first["review"]["available"] is False
    assert first["review"]["reason"]
    launcher.assert_not_called()


def test_suggest_wire_shape_and_states(canonical, factory):
    (factory / "shot-a" / "result.json").unlink()
    (factory / "busy").mkdir()
    (factory / "busy" / "workflow_api.json").write_text("{}")
    (factory / "busy" / "render.json").write_text('{"state":"running","started":1}')
    result = json.loads(core.command("json suggest {}", "sid"))
    assert set(result) == {"runs", "suggestions", "running_count"}
    assert result["running_count"] == 1
    assert result["suggestions"][0]["action"] == "render"
    assert result["suggestions"][0]["status"] == "pending"
    assert set(result["runs"][0]) == {"run", "state", "output", "seconds", "verdict", "shot", "compare"}
    assert json.loads(core.command("json suggest {}", "sid")) == result


@pytest.mark.parametrize("state,action", [("failed", "render"), ("done", "review"), ("running", None)])
def test_suggest_action_from_run_state(canonical, factory, state, action):
    (factory / "shot-a" / "render.json").write_text(json.dumps({"state": state, "started": 1}))
    rows = json.loads(core.command("json suggest {}", "sid"))["suggestions"]
    assert [r["action"] for r in rows] == ([action] if action else [])


def test_pending_and_rejected_never_authorize(canonical, factory):
    row = propose(canonical, factory)
    for status in ["pending", "rejected"]:
        if status == "rejected":
            decide(canonical, row, False)
        result = json.loads(core.command("json render " + json.dumps({"run": "shot-a", "contract_id": row["contract_id"]}), "sid"))
        assert "error" in result
    canonical[3].assert_not_called()


@pytest.mark.parametrize("route", ["direct", "json", "text"])
def test_approved_launch_once_through_all_routes(canonical, factory, route):
    row = propose(canonical, factory)
    decide(canonical, row)
    if route == "direct":
        result = core.render("shot-a", "sid", row["contract_id"])
    elif route == "json":
        result = json.loads(core.command("json render " + json.dumps({"run": "shot-a", "contract_id": row["contract_id"]}), "sid"))
    else:
        assert "Rendering shot-a" in core.command("render shot-a " + row["contract_id"], "sid")
        result = {"state": "queued"}
    assert result["state"] == "queued"
    canonical[3].assert_called_once()
    with pytest.raises(ValueError, match="already claimed"):
        core.render("shot-a", "sid", row["contract_id"])
    canonical[3].assert_called_once()


@pytest.mark.parametrize("damage", ["hash", "sourceHash", "revision", "contract_id", "session_id", "kevin", "time", "scope", "json", "root-missing"])
def test_bad_approved_root_fails_closed(canonical, factory, damage):
    row = propose(canonical, factory)
    path = decide(canonical, row)["path"]
    from pathlib import Path
    path = Path(path)
    doc = json.loads(path.read_text())
    approval = doc["plan"]["bindings"]["approval"]
    if damage in {"sourceHash", "contract_id", "session_id"}:
        approval[damage] = "tampered"
    elif damage == "hash":
        approval["contractHash"] = "0" * 64
    elif damage == "revision":
        doc["revision"] += 1
    elif damage == "kevin":
        approval["approved_by"] = "agent"
    elif damage == "time":
        approval["approved_at"] = "2999-01-01T00:00:00+00:00"
    elif damage == "scope":
        task = next(n["id"] for n in doc["intentGraph"]["nodes"] if n["kind"] == "task")
        doc["plan"]["bindings"][task]["target"] = "some other workflow"
    path.write_text("{" if damage == "json" else json.dumps(doc))
    if damage == "root-missing":
        path.unlink()  # The approved pending copy is NOT authority.
    with pytest.raises(ValueError):
        core.render("shot-a", "sid", row["contract_id"])
    canonical[3].assert_not_called()


@pytest.mark.parametrize("damage", ["json", "approval", "hash", "dropped", "old-revision", "dangling-runtime"])
def test_bad_runtime_fails_closed(canonical, factory, damage):
    row = propose(canonical, factory)
    approved = decide(canonical, row)
    doc = copy.deepcopy(approved["contract"])
    if damage == "approval":
        doc["plan"]["bindings"]["approval"]["approved_by"] = "agent"
    elif damage == "hash":
        doc["constraints"]["budgets"]["attention"] = 99
    elif damage == "dropped":
        task = next(n["id"] for n in doc["intentGraph"]["nodes"] if n["kind"] == "task")
        doc["plan"]["bindings"][task]["status"] = "dropped"
    elif damage == "old-revision":
        doc["revision"] = 0
    path = canonical[2].root / "intent" / "sid" / "runtime" / (row["contract_id"] + ".json")
    path.parent.mkdir()
    if damage == "dangling-runtime":
        path.symlink_to(path.parent / "missing.json")
    else:
        path.write_text("{" if damage == "json" else json.dumps(doc))
    with pytest.raises(ValueError):
        core.render("shot-a", "sid", row["contract_id"])
    canonical[3].assert_not_called()


def test_valid_runtime_is_accepted(canonical, factory):
    row = propose(canonical, factory)
    doc = decide(canonical, row)["contract"]
    doc["revision"] += 1
    path = canonical[2].root / "intent" / "sid" / "runtime" / (row["contract_id"] + ".json")
    path.parent.mkdir()
    path.write_text(json.dumps(doc))
    assert core.render("shot-a", "sid", row["contract_id"])["state"] == "queued"


@pytest.mark.parametrize("damage", ["workflow", "state", "session", "action", "run", "superseded", "request-session"])
def test_stale_cross_scope_and_cross_session_refused(canonical, factory, damage):
    row = propose(canonical, factory, action="review" if damage == "action" else "render")
    decide(canonical, row)
    session, run = "sid", "shot-a"
    if damage == "workflow":
        (factory / run / "workflow_api.json").write_text('{"changed":true}')
    elif damage == "state":
        (factory / run / "result.json").write_text('{"status":"changed"}')
    elif damage == "session":
        session = "other-session"
    elif damage == "run":
        (factory / "other").mkdir()
        (factory / "other" / "workflow_api.json").write_text("{}")
        run = "other"
    elif damage == "superseded":
        propose(canonical, factory, action="review")
    if damage == "request-session":
        result = json.loads(core.command("json render " + json.dumps({"run": run, "contract_id": row["contract_id"], "session_id": "evil"}), session))
        assert "error" in result
    else:
        with pytest.raises(ValueError):
            core.render(run, session, row["contract_id"])
    canonical[3].assert_not_called()


def test_failed_launch_remains_claimed(canonical, factory):
    row = propose(canonical, factory)
    decide(canonical, row)
    canonical[3].side_effect = OSError("synthetic launcher failure")
    with pytest.raises(OSError):
        core.render("shot-a", "sid", row["contract_id"])
    with pytest.raises(ValueError, match="already claimed"):
        core.render("shot-a", "sid", row["contract_id"])
    canonical[3].assert_called_once()


def test_production_machine_proposal_unavailable_without_false_pending(factory, tmp_path, monkeypatch):
    pytest.importorskip("z0int.intent_service")
    pytest.importorskip("aodl_contract")
    monkeypatch.setenv("FACTORY_DATA_DIR", str(tmp_path / "store"))
    result = json.loads(core.command("json suggest {}", "sid"))
    assert result["suggestions"] == []
    assert result["running_count"] == 0
    assert "machine" in result["error"].lower()
    assert result["fail_closed"] is True
    assert not list((tmp_path / "store").rglob("contract-*.json"))


def test_json_suggestion_to_real_canonical_decision_to_stub_process(canonical, factory, monkeypatch):
    import subprocess

    row = json.loads(core.command("json suggest {}", "sid"))["suggestions"][0]
    # Done runs propose review, which must not authorize a render.
    assert row["action"] == "review"
    (factory / "shot-a" / "result.json").unlink()
    row = json.loads(core.command("json suggest {}", "sid"))["suggestions"][0]
    assert row["action"] == "render"
    decide(canonical, row)
    children = []

    def spawn_stub(argv, **kwargs):
        assert argv[0] == str(core.LAUNCHER)
        assert core.LAUNCHER.parent == factory.parent
        child = subprocess.Popen(argv, **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(core, "Popen", spawn_stub)
    result = json.loads(core.command("json render " + json.dumps({"run": row["run"], "contract_id": row["contract_id"]}), "sid"))
    assert result["state"] == "queued"
    assert len(children) == 1
    assert children[0].wait(timeout=5) == 0
    run = json.loads(core.command("json runs {}", "sid"))["runs"][0]
    assert run["state"] == "done" and run["seconds"] == 4


def test_run_alias_cannot_borrow_another_run_approval(canonical, factory):
    row = propose(canonical, factory)
    decide(canonical, row)
    (factory / "alias").symlink_to(factory / "shot-a", target_is_directory=True)
    with pytest.raises(ValueError, match="no run named"):
        core.render("alias", "sid", row["contract_id"])
    canonical[3].assert_not_called()


def test_two_simultaneous_requests_only_launch_once(canonical, factory):
    from concurrent.futures import ThreadPoolExecutor

    row = propose(canonical, factory)
    decide(canonical, row)

    def launch():
        try:
            return core.render("shot-a", "sid", row["contract_id"])["state"]
        except ValueError as error:
            return str(error)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: launch(), range(2)))
    assert results.count("queued") == 1
    assert sum("already claimed" in result for result in results) == 1
    canonical[3].assert_called_once()


def test_approved_and_rejected_rows_keep_identity_after_restart(canonical, factory):
    intents, store, _, _ = canonical
    scope = intents.action_scope(factory / "shot-a", "render", "sid")
    row = propose(canonical, factory)
    decide(canonical, row, False)
    rejected = intents.ActionIntents(store.data_dir).ensure(scope)
    assert rejected == {**row, "status": "rejected"}


def test_malformed_reference_and_wrong_contract_cannot_launch(canonical, factory):
    row = propose(canonical, factory)
    decide(canonical, row)
    with pytest.raises(ValueError):
        core.render("shot-a", "sid", "contract-wrong")
    intents, store, _, launcher = canonical
    reference = store._reference_path(intents.action_scope(factory / "shot-a", "render", "sid"))
    reference.write_text('{"scope":null}')
    with pytest.raises(ValueError):
        core.render("shot-a", "sid", row["contract_id"])
    launcher.assert_not_called()


def test_default_data_directory_and_override(monkeypatch, tmp_path):
    monkeypatch.setattr(core, "_plugin_data_dir", None, raising=False)
    monkeypatch.delenv("FACTORY_DATA_DIR", raising=False)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes-profile"))
    assert core._data_root() == tmp_path / "hermes-profile/plugin-data/factory"
    monkeypatch.setenv("FACTORY_DATA_DIR", str(tmp_path / "override"))
    assert core._data_root() == tmp_path / "override"


def test_registered_directory_reaches_canonical_pending_store(canonical, factory, monkeypatch):
    from types import SimpleNamespace
    from test_core import plugin

    intents, store, service, launcher = canonical
    monkeypatch.setattr(core, "_plugin_data_dir", None, raising=False)
    monkeypatch.delenv("FACTORY_DATA_DIR")
    plugin.register(SimpleNamespace(state=SimpleNamespace(data_dir=store.data_dir),
                                    register_command=lambda *args, **kwargs: None))

    def registered_service(data_dir):
        assert data_dir == store.data_dir
        return service

    monkeypatch.setattr(intents, "create_service", registered_service)
    result = json.loads(core.command("json suggest {}", "sid"))
    assert "error" not in result
    row = result["suggestions"][0]
    assert (store.data_dir / "aodl/intent/sid/.pending" / (row["contract_id"] + ".json")).is_file()
    assert len(list((store.data_dir / "proposals/sid").glob("*.json"))) == 1
    launcher.assert_not_called()


def test_missing_dependency_returns_explicit_unavailable(factory, monkeypatch):
    import builtins
    original = builtins.__import__

    def unavailable(name, *args, **kwargs):
        if name == "z0int.intent_service":
            raise ImportError("synthetic missing dependency")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", unavailable)
    result = json.loads(core.command("json suggest {}", "sid"))
    assert result["suggestions"] == []
    assert result["fail_closed"] is True
    assert "PYTHONPATH" in result["error"]


def test_missing_session_no_approve_verb_and_bad_params(factory):
    assert "error" in json.loads(core.command("json suggest {}"))
    assert "unknown factory verb" in json.loads(core.command("json approve {}", "sid"))["error"]
    for payload in ["[]", "null", '"bad"']:
        assert "error" in json.loads(core.command("json suggest " + payload, "sid"))
