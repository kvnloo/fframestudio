#!/usr/bin/env python3
"""Split Sound Atlas tracks into layers (stems) offline, for the studio view.

Demucs (htdemucs_6s: drums, bass, other, guitar, piano, vocals) separates each track on the GPU
(~5 s per 3-minute track on a 3080 Ti). Each stem is then measured and kept only if it is really
there, encoded small (Opus in WebM), and summarised as a loudness envelope the atlas draws as a
ring at full zoom. Output, next to the catalogue:

  stems.json                       {"model", "hop", "tracks": {id: {"dur", "stems": [...]}}}
  stems/<id>/<stem>.webm           one file per kept stem; the stems sum back to the mix

Usage (in an env with demucs + soundfile, e.g. <local>/project-envs/sound-atlas-stems):
  python tools/sound-atlas-stems.py <catalog-dir> [--ids a,b] [--src shortlist|all] [--tracks-base DIR] [--push REPO]
--ids go first (in order); --src then adds the rest. --push publishes every few tracks to a public HF
dataset (stems.json, stems/, CREDITS.md), which the atlas reads directly, so layers appear without a redeploy.
Only CC0 / CC BY tracks are split: layers are derivatives, and NC/ND/SA terms forbid or bind them.
"""
import argparse, json, os, subprocess, sys, tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

MODEL = "htdemucs_6s"
ORDER = ["drums", "bass", "other", "guitar", "piano", "vocals"]
HOP = 0.5          # envelope step, seconds
FLOOR, TOP = -50.0, -6.0   # dBFS mapped to envelope 0..9
ON_DB = -40.0      # a frame counts as "playing" above this
KEEP_ON, KEEP_PEAK = 0.05, -34.0  # keep a stem heard in >=5% of frames and peaking above -34 dB
BITRATE = os.environ.get("STEM_KBPS", "32k")


def licensed(t):
    lic = (t.get("license") or "").upper()
    return lic.startswith("CC0") or (lic.startswith("CC BY") and not any(x in lic for x in ("NC", "ND", "SA")))


def fetch(t, base, tmp):
    src = t["audio"]
    if not src.startswith("http"):
        return str((base / src).resolve())
    out = Path(tmp) / f"{t['id']}.wav"
    ref = ["-referer", "https://ccmixter.org/"] if "ccmixter.org/" in src else []
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *ref, "-i", src, "-ac", "2", "-ar", "44100", str(out)], check=True, timeout=300)
    return str(out)


def measure(x, sr):
    m = x.mean(1) if x.ndim == 2 else x
    w = int(sr * HOP)
    n = len(m) // w
    rms = np.sqrt((m[: n * w].reshape(n, w) ** 2).mean(1) + 1e-12)
    db = 20 * np.log10(rms)
    env = np.clip(np.round((db - FLOOR) / (TOP - FLOOR) * 9), 0, 9).astype(int)
    return db, "".join(map(str, env))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("catalog_dir", type=Path)
    ap.add_argument("--ids", default="")
    ap.add_argument("--src", default="shortlist")
    ap.add_argument("--tracks-base", type=Path, default=None, help="where relative audio paths resolve (default: catalog dir)")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--push", default="", help="HF dataset repo to publish to, e.g. kvnloo/sound-atlas-stems")
    ap.add_argument("--every", type=int, default=10)
    a = ap.parse_args()
    cat = json.loads((a.catalog_dir / "catalog.json").read_text())
    base = a.tracks_base or a.catalog_dir
    want = list(dict.fromkeys(filter(None, a.ids.split(","))))
    by = {t["id"]: t for t in cat["tracks"]}
    todo = [by[i] for i in want if i in by]
    if a.src != "none" and (a.src == "all" or not want):
        todo += [t for t in cat["tracks"] if t["id"] not in want and (a.src == "all" or t.get("src") == a.src)]
    skipped = [t["id"] for t in todo if not licensed(t)]
    todo = [t for t in todo if licensed(t)]
    out_json = a.catalog_dir / "stems.json"
    doc = json.loads(out_json.read_text()) if out_json.exists() else {"model": MODEL, "hop": HOP, "tracks": {}}
    todo = [t for t in todo if t["id"] not in doc["tracks"]]
    print(f"{len(todo)} to split, {len(skipped)} skipped for licence", file=sys.stderr)
    if not todo:
        return
    batch = []
    for t in todo:
      try:
        # One track per demucs run: a batch run holds every separated track in RAM and got OOM-killed.
        with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as tmp:
            src = fetch(t, base, tmp)
            subprocess.run([sys.executable, "-m", "demucs", "-n", MODEL, "-d", a.device, "-o", tmp, "--filename", "{track}/{stem}.{ext}", src], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            d = Path(tmp) / MODEL / Path(src).stem
            dest = a.catalog_dir / "stems" / t["id"]
            dest.mkdir(parents=True, exist_ok=True)
            stems, dur = [], 0
            for k in ORDER:
                x, sr = sf.read(d / f"{k}.wav")
                dur = len(x) / sr
                db, env = measure(x, sr)
                on = float((db > ON_DB).mean())
                if on < KEEP_ON or db.max() < KEEP_PEAK:
                    continue
                f = dest / f"{k}.webm"
                subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(d / f"{k}.wav"), "-c:a", "libopus", "-b:a", BITRATE, "-vbr", "on", str(f)], check=True)
                stems.append({"k": k, "f": f"stems/{t['id']}/{k}.webm", "on": round(on, 3), "env": env})
            doc["tracks"][t["id"]] = {"dur": round(dur, 2), "stems": stems}
            print(t["id"], [s["k"] for s in stems], file=sys.stderr)
            out_json.write_text(json.dumps(doc, separators=(",", ":")))  # checkpoint per track
            batch.append(t["id"])
      except Exception as e:  # one bad download or split never kills the run
        print(t["id"], "FAILED", repr(e)[:200], file=sys.stderr)
      if a.push and len(batch) >= a.every:
        push(a.push, a.catalog_dir, doc, by, batch); batch = []
    if a.push and batch:
        push(a.push, a.catalog_dir, doc, by, batch)


def push(repo, d, doc, by, ids):
    """Publish new stems plus the index and credits in one commit; retried, never fatal."""
    from huggingface_hub import HfApi
    lines = ["# Credits", "", "Layers (stems) separated with Demucs htdemucs_6s from these CC0 / CC BY tracks. Each stem is a",
             "derivative of the original; credit the original as below when you use it.", ""]
    for i in sorted(doc["tracks"]):
        t = by.get(i)
        if t:
            lines.append(f'- `{i}`: "{t["title"]}" by {t.get("author") or "unknown"}, {t.get("license")}, {t.get("sourceUrl") or t.get("audio")}')
    (d / "CREDITS.md").write_text("\n".join(lines) + "\n")
    for k in range(4):
        try:
            HfApi().upload_folder(repo_id=repo, repo_type="dataset", folder_path=str(d), commit_message=f"stems: +{len(ids)} tracks ({len(doc['tracks'])} total)",
                                  allow_patterns=["stems.json", "CREDITS.md", *[f"stems/{i}/*" for i in ids]])
            print(f"pushed {len(ids)} ({len(doc['tracks'])} total)", file=sys.stderr)
            return
        except Exception as e:
            print("push retry", k, repr(e)[:200], file=sys.stderr); __import__("time").sleep(30 * (k + 1))


if __name__ == "__main__":
    main()
