"""`/factory` behaviour against a temp runs root, a temp scene corpus and a stub launcher."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("factory_plugin", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules["factory_plugin"] = plugin
spec.loader.exec_module(plugin)
core = plugin.core


@pytest.fixture
def factory(tmp_path, monkeypatch):
    runs = tmp_path / "runs"
    (runs / "shot-a").mkdir(parents=True)
    (runs / "shot-a" / "workflow_api.json").write_text("{}")
    (runs / "shot-a" / "result.json").write_text(json.dumps({"status": "success", "outputs": [{"file": "/x/a.mp4"}]}))
    (runs / "shot-a" / "conditioning-manifest.json").write_text(json.dumps({"gate": {"verdict": "SYNCED"}, "runtime": {"seconds": 253}}))
    (runs / "not-a-run").mkdir()
    scenes = tmp_path / "scenes.jsonl"
    scenes.write_text("\n".join(json.dumps(s) for s in [
        {"scene": "Scene 3 - Forest", "videos": 9, "latest_takes": [{"model": "seedance_2_0", "prompt": "dolly through a misty forest", "result": "https://r/1.mp4", "duration": "15", "aspect": "21:9"}]},
        {"scene": "Scene 4 - Hell", "videos": 2, "latest_takes": [{"model": "seedance_2_0", "prompt": "lava demon", "result": "https://r/2.mp4"}]},
        {"scene": "(root)", "videos": 0, "latest_takes": []},
    ]))
    launcher = tmp_path / "factory-comfy"  # status answers; render marks the run done like the real one
    launcher.write_text('#!/bin/sh\ncase "$1" in status) echo \'{"running":false,"free_vram_mb":5600}\';;\n'
                        'render) printf \'{"state":"done","started":1,"finished":5,"exit":0}\' > "$2/render.json";; esac\n')
    launcher.chmod(0o755)
    monkeypatch.setenv("FACTORY_DATA_DIR", str(tmp_path / "plugin-data"))
    monkeypatch.setenv("FACTORY_RUNS", str(runs))
    monkeypatch.setenv("FACTORY_SCENES", str(scenes))
    monkeypatch.setattr(core, "LAUNCHER", launcher)
    return runs


def call(arg):
    return json.loads(core.command(f"json {arg}", "sid"))


def test_status_lists_only_runs_and_reads_their_verdicts(factory):
    s = call("status")
    assert s["comfy"] == {"running": False, "free_vram_mb": 5600}
    assert [r["run"] for r in s["runs"]] == ["shot-a"]
    assert s["runs"][0] | {} == {**s["runs"][0], "state": "done", "output": "/x/a.mp4", "seconds": 253, "verdict": "SYNCED"}
    assert s["rendering"] is None


def test_scenes_ranks_by_words_and_skips_scenes_without_takes(factory):
    hits = call('scenes {"query": "forest dolly"}')["hits"]
    assert [h["scene"] for h in hits] == ["Scene 3 - Forest"]
    assert hits[0]["takes"] == ["https://r/1.mp4"]
    assert call('scenes {"query": "nothing-matches"}')["hits"] == []


def test_render_without_canonical_approval_does_not_start_launcher(factory):
    assert "approval" in call('render {"run": "shot-a"}')["error"].lower()
    assert not (factory / "shot-a" / "render.json").exists()


@pytest.mark.parametrize("run", ["../shot-a", "not-a-run", "", "/etc"])
def test_render_refuses_anything_but_a_run_under_the_root(factory, run):
    assert "no run named" in call(f"render {json.dumps({'run': run})}")["error"]


def test_render_refuses_a_run_already_rendering(factory):
    (factory / "shot-a" / "render.json").write_text(json.dumps({"state": "running", "started": 1}))
    assert "already rendering" in call('render {"run": "shot-a"}')["error"]


def test_unknown_verb_and_bad_json_answer_errors_not_tracebacks(factory):
    assert "unknown factory verb" in call("nope")["error"]
    assert "error" in call("scenes {bad")


def test_text_command_for_frontends_without_cards(factory):
    out = core.command("", "sid")
    assert out.startswith("ComfyUI: down · 5600 MB VRAM free") and "shot-a · done · 253 s · SYNCED" in out
    assert "Scene 3 - Forest" in core.command("scenes forest", "sid")
    assert core.command("scenes", "sid") == "Usage: /factory scenes <words>"
    assert "no run named" in core.command("render ../x", "sid")


def test_direction_drops_asset_sheets_and_keeps_the_shot():
    p = "None\n<<<id>>> [img] - crystal sword sheet\n\n[image2] - knight sheet\n\nCUT 1 - 6s camera tracks the knight\n\nPhotoreal. 16:9."
    assert core.direction(p) == "CUT 1 - 6s camera tracks the knight\n\nPhotoreal. 16:9."
    assert core.direction(None) == ""


def test_register_adds_the_command(monkeypatch):
    monkeypatch.setattr(core, "_plugin_data_dir", None)
    seen = {}
    plugin.register(type("Ctx", (), {"register_command": lambda self, name, fn, description: seen.update({name: fn})})())
    assert seen == {"factory": core.command}
