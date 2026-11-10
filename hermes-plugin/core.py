"""The content factory as a Hermes command: `/factory` text for every frontend, `/factory json <verb>`
for card frontends (the same seam glide uses, so it works on cores without plugin gateway methods).

Reads only: runs under FACTORY_RUNS, the reference scene corpus FACTORY_SCENES, `factory-comfy status`.
`suggest` reconciles proposals through canonical IntentService or fails closed. `render` requires an
exact canonical approval and durable execution claim before starting `factory-comfy render RUN_DIR`.
The launcher owns the GPU gate, service pause/restore and RUN_DIR/render.json.
reuse-checked: fframestudio tern/ -- closed-beta Tern terminal UI, not Hermes; glide -- corrections memory,
  only its `/x json <verb>` card seam is reused; factory-loop/factory-watchdog -- OSS PR factory, unrelated.
"""

from __future__ import annotations

import json
import os
import subprocess
from subprocess import Popen
from pathlib import Path

from . import intents

LAUNCHER = Path(__file__).resolve().parents[1] / "tools" / "factory-comfy"
USAGE = """/factory              status: ComfyUI, GPU, recent runs
/factory runs         recent renders with their verdicts
/factory scenes WORDS search the studied reference scenes (prompts and takes)
/factory suggest      next actions as pending AODL proposals, or an explicit unavailable reason
/factory render RUN CONTRACT_ID   run only with matching canonical Kevin approval"""


_plugin_data_dir: Path | None = None


def configure_data_dir(directory: Path | None) -> None:
    global _plugin_data_dir
    _plugin_data_dir = Path(directory).expanduser() if directory is not None else None


def _data_root() -> Path:
    if os.environ.get("FACTORY_DATA_DIR"):
        return Path(os.environ["FACTORY_DATA_DIR"]).expanduser()
    if _plugin_data_dir is not None:
        return _plugin_data_dir
    return Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser() / "plugin-data" / "factory"


def _runs_root() -> Path:
    return Path(os.environ.get("FACTORY_RUNS", "/mnt/zer0models/project-artifacts/content-factory/runs"))


def _scenes_file() -> Path:
    return Path(os.environ.get("FACTORY_SCENES",
                               "/mnt/zer0models/workspace/zer0/products/taste/factory/hell-grind/scenes.jsonl"))


def _read(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def run_info(d: Path) -> dict:
    render, result, manifest = _read(d / "render.json"), _read(d / "result.json"), _read(d / "conditioning-manifest.json")
    outs = [o["file"] for o in result.get("outputs", []) if o.get("file")]
    state = render.get("state") or ("done" if result.get("status") == "success" else "ready")
    seconds = (render["finished"] - render["started"]) if render.get("finished") else manifest.get("runtime", {}).get("seconds")
    return {"run": d.name, "state": state, "output": outs[0] if outs else None, "seconds": seconds,
            "verdict": manifest.get("gate", {}).get("verdict"), "shot": manifest.get("shot"),
            "compare": str(d / "compare-sheet.png") if (d / "compare-sheet.png").exists() else None}


def runs(limit: int | None = 10) -> list[dict]:
    root = _runs_root()
    dirs = [d for d in root.iterdir() if (d / "workflow_api.json").is_file()] if root.is_dir() else []
    dirs.sort(key=lambda d: d.stat().st_mtime, reverse=True)
    return [run_info(d) for d in dirs[:limit]]


def comfy() -> dict:
    try:
        out = subprocess.run([str(LAUNCHER), "status"], capture_output=True, text=True, timeout=20).stdout
        return json.loads(out)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        return {"running": False, "error": str(error).splitlines()[0] if str(error) else type(error).__name__}


def status() -> dict:
    recent = runs(5)
    return {"comfy": comfy(), "runs": recent, "rendering": next((r["run"] for r in recent if r["state"] == "running"), None)}


def direction(prompt: str | None) -> str:
    """The shot direction of a studied prompt: its paragraphs minus the `<<<asset>>>` reference blocks
    that open most of them (Hell Grind prompts are ~18K chars, mostly character and prop sheets)."""
    paras = [p.strip() for p in (prompt or "").split("\n\n")]
    keep = [p for p in paras if p and p != "None" and not p.removeprefix("None\n").startswith(("<<<", "["))]
    return "\n\n".join(keep)


def scenes(query: str, limit: int = 5) -> list[dict]:
    """Scenes whose name or shot direction holds the most distinct query words; ties go to the
    scene with more videos. Takes sharing one prompt (a batch) are one hit with every take's video."""
    words = set(query.lower().split())
    hits: dict[tuple, dict] = {}
    with _scenes_file().open() as f:
        for line in f:
            s = json.loads(line)
            for t in s.get("latest_takes") or []:
                shot = direction(t.get("prompt"))
                score = sum(w in f"{s.get('scene', '')} {shot}".lower() for w in words)
                if not score:
                    continue
                hit = hits.setdefault((s["scene"], shot), {
                    "scene": s["scene"], "score": score, "videos": s.get("videos", 0), "model": t.get("model"),
                    "direction": shot[:700], "takes": [], "thumb": t.get("thumb"), "duration": t.get("duration")})
                hit["takes"].append(t.get("result"))
    return sorted(hits.values(), key=lambda h: (-h["score"], -h["videos"]))[:limit]


def _run_directory(run: str) -> Path:
    root = _runs_root().resolve()
    d = (root / run).resolve()
    if d.parent != root or d.name != run or not (d / "workflow_api.json").is_file():
        raise ValueError(f"no run named {run!r} under {root}")
    return d


def suggest(session_id: str | None) -> dict:
    recent = runs(None)
    result = {"runs": recent, "suggestions": [], "running_count": sum(r["state"] == "running" for r in recent)}
    try:
        intents.identity(session_id, "session_id")
        store = intents.ActionIntents(_data_root())
        for run in recent:
            action = {"ready": "render", "failed": "render", "done": "review"}.get(run["state"])
            if action:
                scope = intents.action_scope(_run_directory(run["run"]), action, session_id)
                result["suggestions"].append(store.ensure(scope))
    except (ValueError, OSError) as error:
        result.update(error=str(error).splitlines()[0], fail_closed=True)
    return result


def render(run: str, session_id: str | None = None, contract_id: str | None = None) -> dict:
    d = _run_directory(run)
    if run_info(d)["state"] == "running":
        raise ValueError(f"{run} is already rendering")
    intents.identity(session_id, "session_id")
    intents.identity(contract_id, "contract_id")
    scope = intents.action_scope(d, "render", session_id)
    with intents.ActionIntents(_data_root()).execution(scope, contract_id):
        # Recheck after acquiring the interprocess claim lock, before launch.
        if intents.action_scope(d, "render", session_id) != scope or run_info(d)["state"] == "running":
            raise ValueError("Canonical approval is stale; run/workflow state changed")
        with open(d / "render.log", "ab") as log:
            Popen([str(LAUNCHER), "render", str(d)], stdout=log, stderr=log, stdin=subprocess.DEVNULL,
                  start_new_session=True)
    return {"run": d.name, "state": "queued", "log": str(d / "render.log")}


VERBS = {
    "status": lambda p, sid: status(),
    "runs": lambda p, sid: {"runs": runs(int(p.get("limit", 10)))},
    "scenes": lambda p, sid: {"hits": scenes(str(p.get("query", "")), int(p.get("limit", 5)))},
    "suggest": lambda p, sid: suggest(sid),
    "render": lambda p, sid: render(str(p.get("run", "")), sid, p.get("contract_id")),
}


def _json_call(rest: str, session_id: str | None) -> str:
    verb, _, raw = rest.strip().partition(" ")
    try:
        if verb not in VERBS:
            raise ValueError(f"unknown factory verb: {verb or '(none)'}")
        params = json.loads(raw or "{}")
        if not isinstance(params, dict):
            raise ValueError("factory parameters must be a JSON object")
        if "session_id" in params and params["session_id"] != session_id:
            raise ValueError("factory session_id must match the authenticated command session")
        return json.dumps(VERBS[verb](params, session_id))
    except (ValueError, TypeError, OSError) as error:
        return json.dumps({"error": str(error).splitlines()[0], "fail_closed": True})


def _run_line(r: dict) -> str:
    bits = [r["run"], r["state"]] + ([f"{r['seconds']} s"] if r.get("seconds") else []) + ([r["verdict"]] if r.get("verdict") else [])
    return "- " + " · ".join(bits) + (f"\n  {r['output']}" if r.get("output") else "")


def command(raw_args: str = "", session_id: str | None = None) -> str:
    verb, _, rest = (raw_args or "").strip().partition(" ")
    verb = verb.lower()
    try:
        if verb == "json":
            return _json_call(rest, session_id)
        if verb in ("help", "-h", "--help"):
            return USAGE
        if verb == "runs":
            return "\n".join(_run_line(r) for r in runs()) or "No runs yet."
        if verb == "scenes":
            if not rest.strip():
                return "Usage: /factory scenes <words>"
            return "\n".join(f"- {h['scene']} ({h['model']}, {h['duration']}s, {h['videos']} videos)\n  {h['direction'][:300]}\n  "
                             + "\n  ".join(map(str, h["takes"])) for h in scenes(rest)) or "No matching scene."
        if verb == "suggest":
            result = suggest(session_id)
            if "error" in result:
                return "/factory: " + result["error"]
            return "\n".join(f"- {s['title']} · {s['status']} · {s['contract_id']}\n  {s['review']['reason']}"
                             for s in result["suggestions"]) or "No suggested actions."
        if verb == "render":
            parts = rest.strip().split()
            r = render(parts[0] if parts else "", session_id, parts[1] if len(parts) == 2 else None)
            return f"Rendering {r['run']} in the background. Log: {r['log']}. Check with /factory runs."
        if verb:
            return USAGE
        s = status()
        c = s["comfy"]
        head = f"ComfyUI: {'up' if c.get('running') else 'down'} · {c.get('free_vram_mb', '?')} MB VRAM free" + (
            f" · rendering {s['rendering']}" if s["rendering"] else "")
        return "\n".join([head, *(_run_line(r) for r in s["runs"]), "", USAGE])
    except (ValueError, OSError) as error:
        return f"/factory: {str(error).splitlines()[0]}"
