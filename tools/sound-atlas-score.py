#!/usr/bin/env python3
"""Transcribe Sound Atlas tracks into notes and sheet music offline, for the Score view.

Two audio.cpp models run on each track (CPU works; ~1.5x real time for MuScriptor on groot):
  MuScriptor small  audio -> multi-instrument note events (piano, bass, drums, guitar, ...)
  SheetSage2        audio -> lead sheet in ABC (melody + chords), optional (--abc)
Output, next to stems.json in the same public HF dataset, so scores appear without a redeploy:

  scores.json             {"model", "tracks": {id: {"f": "scores/<id>.json", "abc": "scores/<id>.abc"?, "n": notes}}}
  scores/<id>.json        {"v": 1, "inst": [names], "n": [[onset s, dur s, midi pitch, inst index], ...]}
  scores/<id>.abc         SheetSage2 lead sheet

Usage:
  python tools/sound-atlas-score.py <catalog.json> <out-dir> --ids a,b [--abc] [--max-sec 240] [--push kvnloo/sound-atlas-stems]
Env: ACPP_CLI (audiocpp_cli binary), ACPP_MODELS (model root with MuScriptor-Small-GGUF/, SheetSage2-GGUF/).
Model weights are CC-BY-NC-4.0 (non-commercial); only CC0 / CC BY tracks are transcribed, like stems.
"""
import argparse, json, os, subprocess, tempfile, urllib.request
from pathlib import Path

CLI = os.environ.get("ACPP_CLI", "audiocpp_cli")
MODELS = Path(os.environ.get("ACPP_MODELS", "models"))
MUSCRIPTOR = MODELS / "MuScriptor-Small-GGUF/muscriptor-small-f32.gguf"
SHEETSAGE = MODELS / "SheetSage2-GGUF/sheetsage2-orig.gguf"


def licensed(t):
    lic = (t.get("license") or "").upper().replace("-", " ")
    return "CC0" in lic or (("CC BY" in lic or "ATTRIBUTION" in lic) and not any(x in lic for x in ("NC", "ND", "SA")))


def notes(events):
    """MuScriptor's start/end event stream -> [[onset, dur, pitch, inst]] sorted by onset, plus the instrument names."""
    inst, starts, out = [], {}, []
    for e in events:
        if e["type"] == "start":
            starts[e["index"]] = e
        elif e["type"] == "end" and e["start_event_index"] in starts:
            s = starts.pop(e["start_event_index"])
            if s["instrument"] not in inst: inst.append(s["instrument"])
            out.append([round(s["start_time"], 2), round(max(0.01, e["end_time"] - s["start_time"]), 2), s["pitch"], inst.index(s["instrument"])])
    out.sort(key=lambda n: (n[0], n[2]))
    return inst, out


def run(args):
    subprocess.run([CLI, "--task", "midi", "--backend", "cpu", "--threads", os.environ.get("ACPP_THREADS", "3"), *args], check=True, capture_output=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("catalog", help="catalog.json path or URL")
    ap.add_argument("out", type=Path)
    ap.add_argument("--ids", required=True)
    ap.add_argument("--abc", action="store_true", help="also write a SheetSage2 lead sheet")
    ap.add_argument("--max-sec", type=float, default=240, help="transcribe at most this much of each track")
    ap.add_argument("--push", default="")
    a = ap.parse_args()
    src = a.catalog if "://" in a.catalog else Path(a.catalog).resolve().as_uri()
    cat = {t["id"]: t for t in json.load(urllib.request.urlopen(src))["tracks"]}
    (a.out / "scores").mkdir(parents=True, exist_ok=True)
    idx_f = a.out / "scores.json"
    doc = json.loads(idx_f.read_text()) if idx_f.exists() else {"model": "muscriptor-small", "tracks": {}}
    done = []
    for i in a.ids.split(","):
        t = cat.get(i)
        if not t or not licensed(t): print(f"skip {i}: not in catalogue or not CC0/CC BY"); continue
        with tempfile.TemporaryDirectory() as tmp:
            wav, ev = Path(tmp) / "a.wav", Path(tmp) / "ev.json"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-t", str(a.max_sec), "-i", t["audio"], "-ac", "2", "-ar", "44100", str(wav)], check=True)
            run(["--family", "muscriptor", "--model", str(MUSCRIPTOR), "--audio", str(wav), "--request-option", "output_format=json", "--out", str(ev)])
            inst, n = notes(json.loads(ev.read_text()))
            (a.out / f"scores/{i}.json").write_text(json.dumps({"v": 1, "inst": inst, "n": n}, separators=(",", ":")))
            entry = {"f": f"scores/{i}.json", "n": len(n)}
            if a.abc:
                run(["--family", "sheetsage2", "--model", str(SHEETSAGE), "--audio", str(wav), "--out", str(a.out / f"scores/{i}.abc")])
                entry["abc"] = f"scores/{i}.abc"
        doc["tracks"][i] = entry; done.append(i)
        idx_f.write_text(json.dumps(doc, indent=1))
        print(f"{i}: {len(n)} notes, {', '.join(inst)}{' + lead sheet' if a.abc else ''}")
    if a.push and done:
        from huggingface_hub import HfApi
        HfApi().upload_folder(repo_id=a.push, repo_type="dataset", folder_path=str(a.out), commit_message=f"scores: +{len(done)} tracks ({len(doc['tracks'])} total)",
                              allow_patterns=["scores.json", *[f"scores/{i}.*" for i in done]])


if __name__ == "__main__":
    main()
