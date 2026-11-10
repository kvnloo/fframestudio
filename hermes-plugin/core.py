"""The content factory as a Hermes command: `/factory` text for every frontend, `/factory json <verb>`
for card frontends (the same seam glide uses, so it works on cores without plugin gateway methods).

Reads only: runs under FACTORY_RUNS, the reference scene corpus FACTORY_SCENES, `factory-comfy status`.
Writes only by `render`, which starts `factory-comfy render RUN_DIR` detached; that script owns the GPU
gate, the service pause/restore and RUN_DIR/render.json.
reuse-checked: fframestudio tern/ -- closed-beta Tern terminal UI, not Hermes; glide -- corrections memory,
  only its `/x json <verb>` card seam is reused; factory-loop/factory-watchdog -- OSS PR factory, unrelated.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

LAUNCHER = Path(__file__).resolve().parents[1] / "tools" / "factory-comfy"
USAGE = """/factory              status: ComfyUI, GPU, recent runs
/factory runs         recent renders with their verdicts
/factory scenes WORDS search the studied reference scenes (prompts and takes)
/factory render RUN   re-run RUN's workflow (pauses GPU services, restores them after)"""


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


def runs(limit: int = 10) -> list[dict]:
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


def render(run: str) -> dict:
    root = _runs_root().resolve()
    d = (root / run).resolve()
    if d.parent != root or not (d / "workflow_api.json").is_file():
        raise ValueError(f"no run named {run!r} under {root}")
    if run_info(d)["state"] == "running":
        raise ValueError(f"{run} is already rendering")
    # The launcher marks render.json and holds a lock; a launch that fails early leaves its reason in render.log.
    with open(d / "render.log", "ab") as log:
        subprocess.Popen([str(LAUNCHER), "render", str(d)], stdout=log, stderr=log, stdin=subprocess.DEVNULL,
                         start_new_session=True)
    return {"run": d.name, "state": "queued", "log": str(d / "render.log")}


VERBS = {
    "status": lambda p: status(),
    "runs": lambda p: {"runs": runs(int(p.get("limit", 10)))},
    "scenes": lambda p: {"hits": scenes(str(p.get("query", "")), int(p.get("limit", 5)))},
    "render": lambda p: render(str(p.get("run", ""))),
}


def _json_call(rest: str) -> str:
    verb, _, raw = rest.strip().partition(" ")
    try:
        if verb not in VERBS:
            raise ValueError(f"unknown factory verb: {verb or '(none)'}")
        return json.dumps(VERBS[verb](json.loads(raw or "{}")))
    except (ValueError, TypeError, OSError) as error:
        return json.dumps({"error": str(error).splitlines()[0]})


def _run_line(r: dict) -> str:
    bits = [r["run"], r["state"]] + ([f"{r['seconds']} s"] if r.get("seconds") else []) + ([r["verdict"]] if r.get("verdict") else [])
    return "- " + " · ".join(bits) + (f"\n  {r['output']}" if r.get("output") else "")


def command(raw_args: str = "", session_id: str | None = None) -> str:
    verb, _, rest = (raw_args or "").strip().partition(" ")
    verb = verb.lower()
    try:
        if verb == "json":
            return _json_call(rest)
        if verb in ("help", "-h", "--help"):
            return USAGE
        if verb == "runs":
            return "\n".join(_run_line(r) for r in runs()) or "No runs yet."
        if verb == "scenes":
            if not rest.strip():
                return "Usage: /factory scenes <words>"
            return "\n".join(f"- {h['scene']} ({h['model']}, {h['duration']}s, {h['videos']} videos)\n  {h['direction'][:300]}\n  "
                             + "\n  ".join(map(str, h["takes"])) for h in scenes(rest)) or "No matching scene."
        if verb == "render":
            r = render(rest.strip())
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
