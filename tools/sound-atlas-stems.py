#!/usr/bin/env python3
"""Split Sound Atlas tracks into layers (stems) offline, for the studio view.

Demucs (htdemucs_6s: drums, bass, other, guitar, piano, vocals) separates each track on the GPU
(~5 s per 3-minute track on a 3080 Ti; the model stays loaded and decode, encode and upload overlap it). Each stem is then measured and kept only if it is really
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

import time
from concurrent.futures import ThreadPoolExecutor

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


SR = 44100


def load(t, base, max_min):
    """Decode a track to float32 stereo 44.1 kHz in memory (remote ones stream through ffmpeg)."""
    src = t["audio"]
    if max_min and (t.get("dur") or 0) > max_min * 60:
        return None
    if not src.startswith("http"):
        src = str((base / src).resolve())
    ref = ["-referer", "https://ccmixter.org/"] if "ccmixter.org/" in src else []
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", *ref, "-i", src, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, timeout=300, capture_output=True).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2)
    return None if max_min and len(x) > max_min * 60 * SR else x


def encode(x, f):
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    "-c:a", "libopus", "-b:a", BITRATE, "-vbr", "on", str(f)], input=np.ascontiguousarray(x, np.float32).tobytes(), check=True)


class Separator:
    """htdemucs_6s loaded once and kept on the GPU (the old per-track CLI reloaded torch + weights every time)."""
    def __init__(self, device):
        import torch
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        self.torch, self.apply, self.dev = torch, apply_model, device
        self.model = get_model(MODEL).to(device).eval()

    def __call__(self, x):
        th = self.torch
        w = th.from_numpy(x.T.copy())
        ref = w.mean(0); m, sd = ref.mean(), ref.std() + 1e-8
        with th.inference_mode():
            y = self.apply(self.model, ((w - m) / sd)[None], device=self.dev, shifts=1, split=True, overlap=0.25, progress=False)[0]
        y = (y * sd + m).cpu().numpy()
        return {k: y[i].T for i, k in enumerate(self.model.sources)}


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
    ap.add_argument("--max-min", type=float, default=12, help="skip tracks longer than this many minutes (a 59 min one OOM-killed the box)")
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
    sep = Separator(a.device)
    pool = ThreadPoolExecutor(max_workers=6)  # opus encodes + the next download overlap the GPU
    nxt = pool.submit(load, todo[0], base, a.max_min) if todo else None
    for i, t in enumerate(todo):
      try:
        wav = nxt.result()
        nxt = pool.submit(load, todo[i + 1], base, a.max_min) if i + 1 < len(todo) else None
        if wav is None:
            print(t["id"], "SKIPPED longer than", a.max_min, "min", file=sys.stderr); continue
        t0 = time.time()
        out = sep(wav)  # {stem: (samples, 2) float32}
        t1 = time.time()
        dest = a.catalog_dir / "stems" / t["id"]
        dest.mkdir(parents=True, exist_ok=True)
        stems, jobs = [], []
        for k in ORDER:
            x = out[k]
            db, env = measure(x, SR)
            on = float((db > ON_DB).mean())
            if on < KEEP_ON or db.max() < KEEP_PEAK:
                continue
            jobs.append(pool.submit(encode, x, dest / f"{k}.webm"))
            stems.append({"k": k, "f": f"stems/{t['id']}/{k}.webm", "on": round(on, 3), "env": env})
        for j in jobs: j.result()
        doc["tracks"][t["id"]] = {"dur": round(len(wav) / SR, 2), "stems": stems}
        print(t["id"], [s["k"] for s in stems], f"sep {t1 - t0:.1f}s enc {time.time() - t1:.1f}s", file=sys.stderr)
        out_json.write_text(json.dumps(doc, separators=(",", ":")))  # checkpoint per track
        batch.append(t["id"])
      except Exception as e:  # one bad download or split never kills the run
        print(t["id"], "FAILED", repr(e)[:200], file=sys.stderr)
        if nxt is None and i + 1 < len(todo): nxt = pool.submit(load, todo[i + 1], base, a.max_min)
      if a.push and len(batch) >= a.every:
        pool.submit(push, a.push, a.catalog_dir, json.loads(json.dumps(doc)), by, batch); batch = []  # upload overlaps too
    pool.shutdown(wait=True)
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
