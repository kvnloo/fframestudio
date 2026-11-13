#!/usr/bin/env python3
"""Where every beat falls, and how hard the music hits, for the whole of each Sound Atlas track.

Usage: music-beats.py <catalog.json> <out-dir> [--limit N] [--jobs 6] [--device cuda] [--ids a,b]

music-features.py hears 30 s and fits ONE tempo and downbeat, so the canvas dance drifts off the
music (against Beat This! its grid scored beat F 0.31 / downbeat F 0.08 on the shortlist; tempo
was 1.5x or 2x off on 6 of 14). This pass runs Beat This! (CPJKU, ISMIR 2024, the most accurate
DBN-free beat + downbeat tracker; final0 checkpoint, ~1 s a track on the GPU, most of it decoding)
over the whole track and adds a 20 Hz loudness + low/mid/high onset curve, so the dance can follow
tempo changes, the bar, and the music's energy instead of a metronome.

Writes <out-dir>/<id>.bin per track (skipped when present, so reruns resume) and
<out-dir>/index.json {v, fps, ids}. The client fetches only the playing track's file.
Binary layout, little endian:
  0   "SAB1"
  4   u16 beats, u16 frames, u8 fps, u8 channels (4), u16 0
  12  beats x u32   time in ms, bit 31 set on a downbeat
  ..  beats x u8    beat confidence (sigmoid of the model's logit at the beat, x255)
  ..  frames x 4 u8 loudness (dB over -60..0 of the track's peak), low/mid/high onset strength
"""
import argparse, json, os, struct, subprocess, sys, concurrent.futures as cf
import numpy as np

SR, FPS, BANDS = 22050, 20, ((0, 200), (200, 2000), (2000, 11025))


def decode(url):
    # ccMixter hotlink-protects files: it serves them only with its own Referer.
    ref = ["-referer", "https://ccmixter.org/"] if "ccmixter.org/" in url else []
    cmd = ["ffmpeg", "-nostdin", "-v", "error", *ref, "-i", url, "-ac", "1", "-ar", str(SR), "-t", "900", "-f", "f32le", "-"]
    x = np.frombuffer(subprocess.run(cmd, capture_output=True, timeout=300).stdout, dtype=np.float32)
    return x if x.size >= SR * 4 else None


def curves(x):
    """20 Hz loudness and per-band onset strength (positive spectral flux), each scaled to a byte."""
    hop, n = SR // FPS, 2048
    x = np.pad(x, (n // 2, n // 2))
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop]
    mag = np.abs(np.fft.rfft(fr * np.hanning(n).astype(np.float32), axis=1))
    rms = np.sqrt(np.mean(fr ** 2, axis=1)) + 1e-9
    db = 20 * np.log10(rms / rms.max())
    out = [np.clip((db + 60) / 60 * 255, 0, 255)]
    hz = np.fft.rfftfreq(n, 1 / SR)
    for lo, hi in BANDS:
        b = np.log1p(mag[:, (hz >= lo) & (hz < hi)].sum(1))
        flux = np.maximum(0, np.diff(b, prepend=b[0]))
        out.append(np.clip(flux / (np.percentile(flux, 99) + 1e-9) * 255, 0, 255))
    return np.stack(out, 1).round().astype(np.uint8)


def pack(beats, downs, conf, cv):
    down = set(np.round(np.asarray(downs) * 1000).astype(int).tolist())
    ms = np.round(np.asarray(beats) * 1000).astype(np.int64)
    words = np.array([m | (1 << 31 if m in down else 0) for m in ms], dtype="<u4")
    nb, nf = min(len(words), 65535), min(len(cv), 65535)
    return (b"SAB1" + struct.pack("<HHBBH", nb, nf, FPS, cv.shape[1], 0) + words[:nb].tobytes()
            + np.asarray(conf, dtype=np.uint8)[:nb].tobytes() + cv[:nf].tobytes())


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("catalog"); ap.add_argument("out")
    ap.add_argument("--limit", type=int); ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--device", default="cuda"); ap.add_argument("--ids")
    a = ap.parse_args()
    import torch
    from beat_this.inference import Audio2Frames
    from beat_this.model.postprocessor import Postprocessor
    cat = json.load(open(a.catalog)); tracks = cat["tracks"] if isinstance(cat, dict) else cat
    base = os.path.dirname(os.path.abspath(a.catalog)) + "/"
    url = lambda t: t["audio"] if t["audio"].startswith("http") else base + t["audio"]
    os.makedirs(a.out, exist_ok=True)
    want = set(a.ids.split(",")) if a.ids else None
    todo = [t for t in tracks if t.get("audio") and t.get("src") != "web" and (not want or t["id"] in want)
            and not os.path.exists(f"{a.out}/{t['id']}.bin")][: a.limit]
    a2f = Audio2Frames("final0", device=a.device)  # fp32: fp16 saved nothing (decode-bound) and moved beats (F 0.93 worst)
    post = Postprocessor(type="minimal")
    print(f"todo {len(todo)}", file=sys.stderr, flush=True)

    def fetch(t):
        try: return t, decode(url(t))  # a slow or dead host costs one track, never the run
        except Exception as e: print(f"fail {t['id']}: {e}", file=sys.stderr); return t, None

    done = 0
    with cf.ThreadPoolExecutor(a.jobs) as ex:
        for i in range(0, len(todo), 24):  # bounded: decoded audio is ~10 MB a track
            for t, x in ex.map(fetch, todo[i:i + 24]):
                if x is None: print(f"skip {t['id']}", file=sys.stderr); continue
                try:
                    with torch.inference_mode():
                        bl, dl = a2f(x, SR)
                        beats, downs = post(bl, dl)
                    fr = np.clip(np.round(np.asarray(beats) * 50).astype(int), 0, bl.shape[-1] - 1)  # model runs at 50 fps
                    conf = (torch.sigmoid(bl.float()).cpu().numpy()[fr] * 255).round()
                    tmp = f"{a.out}/{t['id']}.bin.tmp"
                    open(tmp, "wb").write(pack(beats, downs, conf, curves(x))); os.replace(tmp, f"{a.out}/{t['id']}.bin")
                    done += 1
                except Exception as e: print(f"fail {t['id']}: {e}", file=sys.stderr)
            print(f"beats {min(i + 24, len(todo))}/{len(todo)} ok {done}", file=sys.stderr, flush=True)
    ids = sorted(f[:-4] for f in os.listdir(a.out) if f.endswith(".bin"))
    json.dump({"v": 1, "fps": FPS, "ids": ids}, open(f"{a.out}/index.json", "w"), separators=(",", ":"))
    print(f"done {done} new, {len(ids)} total", file=sys.stderr)


if __name__ == "__main__":
    main()
