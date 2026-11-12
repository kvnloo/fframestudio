#!/usr/bin/env python3
"""Listen to every Sound Atlas track and describe it the way an audiophile or editor would.

Usage: music-features.py <catalog.json> <out.json> [--clap] [--limit N] [--jobs 8]

For each track, decode 30 s of stereo (from 0:30, or from the start for short tracks) with
ffmpeg over HTTP range requests, and measure it with numpy, using the same vocabulary as
Aural's soundstage (side/mid width, L/R correlation, octave bands, low/mid/high onsets):

  tempo       BPM from the onset envelope's autocorrelation (log-normal prior around 120)
  key         Krumhansl-Schmuckler on a 65 Hz-5 kHz chroma -> "A minor", Camelot "8A", confidence
  bright      spectral centroid (Hz), the register the mix lives in
  clarity     octave spectral contrast (peak minus valley, dB): high = separated, low = washy
  width       side/mid RMS ratio; corr = L/R correlation (1 = mono)
  busy        onsets per second, overall and per band (low < 200 Hz, mid, high > 2 kHz)
  dyn         crest factor (dB) and loudness range (p95 - p10 of 400 ms RMS, dB)
  low / air   energy share below 120 Hz / above 8 kHz
  bands       10 octave-band levels (32 Hz-16 kHz), relative dB, the tonal fingerprint

--clap adds LAION CLAP (laion/clap-htsat-unfused). It gives zero-shot instrument and timbre
tags (z-scored across the catalogue, so "piano" means more piano than usual) and a 512-d audio
embedding, written as int8 to <out>.clap.bin for "sounds like" neighbours.
"""
import json, math, subprocess, sys, concurrent.futures as cf, argparse
import numpy as np

SR = 22050
KS_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
PC = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
INSTRUMENTS = ["piano", "acoustic guitar", "electric guitar", "synth lead", "synth pad", "arpeggiated synth",
               "8-bit chiptune", "string ensemble", "brass", "woodwinds", "choir", "vocals", "acoustic drum kit",
               "electronic drums", "bass guitar", "deep sub bass", "bells and mallets", "orchestral percussion",
               "organ", "plucked synth", "ukulele", "hand claps"]
TIMBRE = ["clean and polished", "lo-fi and dusty", "distorted and gritty", "warm and soft", "bright and sparkly",
          "dark and heavy", "airy and spacious", "punchy and tight"]



def finite(x, nd):
    x = float(x)
    return round(x, nd) if math.isfinite(x) else None

def decode(url, dur):
    start = 30 if (dur or 0) > 75 else 0
    # ccMixter hotlink-protects files: it serves them only with its own Referer (what its download button sends).
    ref = ["-referer", "https://ccmixter.org/"] if "ccmixter.org/" in url else []
    cmd = ["ffmpeg", "-nostdin", "-v", "error", *ref, "-ss", str(start), "-t", "30", "-i", url,
           "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, timeout=120).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    if x.size < SR * 4: return None
    return x[: x.size // 2 * 2].reshape(-1, 2)


def stft(x, n=2048, hop=512):
    w = np.hanning(n).astype(np.float32)
    f = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * w
    return np.abs(np.fft.rfft(f, axis=1))


def onsets(flux, fps):
    """Peak-pick a novelty curve: above a moving median + delta, at least 60 ms apart."""
    if flux.size < 8: return 0
    k = max(3, int(fps * 0.5)) | 1
    pad = np.pad(flux, k // 2, mode="edge")
    med = np.median(np.lib.stride_tricks.sliding_window_view(pad, k), axis=1)
    thr = med + 0.5 * flux.std()
    pk = (flux > thr) & (flux >= np.roll(flux, 1)) & (flux >= np.roll(flux, -1))
    idx = np.flatnonzero(pk); gap = int(fps * 0.06); n, last = 0, -gap
    for i in idx:
        if i - last >= gap: n += 1; last = i
    return n


def tempo(env, fps):
    """Autocorrelate the onset envelope and score each beat period with its bar multiples
    (a harmonic sum), so the pulse wins over its half/third; a log-normal prior near 115 BPM
    settles the remaining octave choice."""
    k = int(fps * 1.0) | 1
    env = env - np.convolve(env, np.ones(k) / k, mode="same")
    env = np.maximum(env, 0)
    ac = np.correlate(env, env, mode="full")[env.size - 1:]; ac = ac / (ac[0] + 1e-9)
    lags = np.arange(int(fps * 60 / 210), int(fps * 60 / 55) + 1)
    acf = lambda L: np.interp(L, np.arange(ac.size), ac)
    score = np.array([acf(L) + 0.5 * acf(2 * L) + 0.33 * acf(4 * L) for L in lags])
    bpm = 60 * fps / lags
    score = score * np.exp(-0.5 * (np.log2(bpm / 115) / 0.8) ** 2)
    i = int(np.argmax(score))
    if 0 < i < len(lags) - 1:  # parabolic peak refinement
        a, b, c = score[i - 1], score[i], score[i + 1]; d = 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
        L = lags[i] + np.clip(d, -0.5, 0.5)
    else: L = lags[i]
    conf = float(score[i] / (np.median(score) + 1e-9))
    return round(60 * fps / L, 1), round(min(max(conf - 1, 0) / 3, 1), 2)


def features(x):
    L, Rr = x[:, 0], x[:, 1]
    mid, side = (L + Rr) / 2, (L - Rr) / 2
    rms = lambda v: float(np.sqrt(np.mean(v ** 2)) + 1e-12)
    S = stft(mid); freqs = np.fft.rfftfreq(2048, 1 / SR); fps = SR / 512
    P = S ** 2; tot = P.sum(axis=1) + 1e-12
    cen = float(np.median((S * freqs).sum(axis=1) / (S.sum(axis=1) + 1e-12)))  # magnitude-weighted, as librosa
    # Octave bands 32 Hz..16 kHz (10), relative dB; contrast = peak vs valley inside each band.
    edges = 31.25 * 2 ** np.arange(11); bands, contrast = [], []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (freqs >= lo) & (freqs < min(hi, SR / 2))
        if not m.any(): bands.append(-60.0); continue
        e = P[:, m]; bands.append(10 * np.log10(e.sum(axis=1).mean() + 1e-12))
        if m.sum() >= 4:
            srt = np.sort(e, axis=1); q = max(1, int(srt.shape[1] * 0.2))
            contrast.append(np.median(10 * np.log10(srt[:, -q:].mean(1) + 1e-12) - 10 * np.log10(srt[:, :q].mean(1) + 1e-12)))
    bands = np.array(bands); bands = np.round(bands - bands.max(), 1)
    flux_b = {}
    d = np.maximum(0, np.diff(np.log1p(S * 10), axis=0))
    for name, (lo, hi) in {"low": (20, 200), "mid": (200, 2000), "high": (2000, 11000)}.items():
        m = (freqs >= lo) & (freqs < hi); flux_b[name] = d[:, m].sum(axis=1)
    flux = d.sum(axis=1); secs = x.shape[0] / SR
    bpm, bconf = tempo(flux, fps)
    # Chroma -> key.
    m = (freqs >= 65) & (freqs <= 5000)
    pcs = (np.round(12 * np.log2(freqs[m] / 440)) + 9) % 12
    chroma = np.array([np.log1p(S[:, m][:, pcs == p]).sum() for p in range(12)])
    best = (-2, 0, "major")
    for r in range(12):
        for prof, mode in ((KS_MAJ, "major"), (KS_MIN, "minor")):
            c = np.corrcoef(np.roll(prof, r), chroma)[0, 1]
            if c > best[0]: best = (c, r, mode)
    kc, root, mode = best
    rel = root if mode == "major" else (root + 3) % 12
    camelot = f"{(7 * rel + 7) % 12 + 1}{'B' if mode == 'major' else 'A'}"
    w = int(SR * 0.4); seg = mid[: mid.size // w * w].reshape(-1, w)
    st = 20 * np.log10(np.sqrt((seg ** 2).mean(1)) + 1e-9); st = st[st > st.max() - 40]
    return {
        "tempo": bpm, "tempoConf": bconf,
        "key": f"{PC[root]} {mode}", "camelot": camelot, "keyConf": round(float(kc), 2),
        "bright": round(cen), "clarity": round(float(np.mean(contrast)), 1) if contrast else None,
        "width": round(rms(side) / rms(mid), 3), "corr": finite(np.corrcoef(L, Rr)[0, 1], 3),  # one silent channel -> undefined, not NaN
        "busy": round(onsets(flux, fps) / secs, 2),
        "busyBands": {k: round(onsets(v, fps) / secs, 2) for k, v in flux_b.items()},
        "crest": round(float(20 * np.log10(np.abs(mid).max() / rms(mid) + 1e-9)), 1),  # float(): float32 rounding leaks digits into JSON
        "lra": round(float(np.percentile(st, 95) - np.percentile(st, 10)), 1) if st.size > 4 else None,
        "loud": round(20 * np.log10(rms(mid)), 1),
        "low": round(float(P[:, freqs < 120].sum() / tot.sum()), 3),
        "air": round(float(P[:, freqs > 8000].sum() / tot.sum()), 4),
        "bands": bands.tolist(),
    }


class Clap:
    """Streams 10 s clips through CLAP in small batches so memory stays flat (only 512-d vectors kept)."""
    def __init__(self):
        import torch
        from transformers import ClapModel, ClapProcessor
        self.torch = torch
        torch.set_num_threads(max(1, (__import__("os").cpu_count() or 4)))
        self.dev = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
        self.model = ClapModel.from_pretrained("laion/clap-htsat-unfused").to(self.dev).eval()
        self.proc = ClapProcessor.from_pretrained("laion/clap-htsat-unfused")
        self.buf, self.embs = [], []

    def add(self, clip):
        self.buf.append(clip)
        if len(self.buf) >= 16: self.flush()

    def flush(self):
        if not self.buf: return
        with self.torch.no_grad():
            a = self.proc(audios=self.buf, sampling_rate=48000, return_tensors="pt").to(self.dev)
            self.embs.append(self.torch.nn.functional.normalize(self.model.get_audio_features(**a), dim=-1).cpu())
        self.buf = []
        print(f"clap {sum(len(e) for e in self.embs)}", file=sys.stderr, flush=True)

    def finish(self, feats):
        self.flush(); torch = self.torch
        labels = INSTRUMENTS + TIMBRE
        with torch.no_grad():
            ti = self.proc(text=[f"This is the sound of {l}." for l in labels], return_tensors="pt", padding=True).to(self.dev)
            tv = torch.nn.functional.normalize(self.model.get_text_features(**ti), dim=-1).cpu()
        A = torch.cat(self.embs); sims = (A @ tv.T).numpy()
        z = (sims - sims.mean(0)) / (sims.std(0) + 1e-9); ni = len(INSTRUMENTS)
        for f, row in zip(feats, z):
            order = np.argsort(-row[:ni]); f["inst"] = [[INSTRUMENTS[j], round(float(row[j]), 2)] for j in order[:4] if row[j] > 0.6]
            tj = int(np.argmax(row[ni:])); f["timbre"] = TIMBRE[tj] if row[ni + tj] > 0.5 else None
        return A.numpy()


def clip48(x):
    """10 s mono at 48 kHz from the middle of the decoded window, for CLAP."""
    m = x.mean(1); mid = m[m.size // 2 - SR * 5: m.size // 2 + SR * 5]
    return np.interp(np.arange(0, mid.size, SR / 48000), np.arange(mid.size), mid).astype(np.float32)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("catalog"); ap.add_argument("out")
    ap.add_argument("--clap", action="store_true"); ap.add_argument("--limit", type=int); ap.add_argument("--jobs", type=int, default=8)
    a = ap.parse_args()
    cat = json.load(open(a.catalog)); tracks = cat["tracks"] if isinstance(cat, dict) else cat
    base = a.catalog.rsplit("/", 1)[0] + "/" if "/" in a.catalog else "./"
    todo = [t for t in tracks if t.get("audio")][: a.limit]
    url = lambda t: t["audio"] if t["audio"].startswith("http") else base + t["audio"]
    out, keep = {}, []
    clap = Clap() if a.clap else None

    def one(t):
        try:  # a slow or dead host costs one track, never the run
            x = decode(url(t), t.get("dur"))
            return t, x, (features(x) if x is not None else None)
        except Exception as e: print(f"fail {t['id']}: {e}", file=sys.stderr); return t, None, None

    def results(ex):  # bounded: decoded audio is ~5 MB a track, so never queue the whole catalogue
        for i in range(0, len(todo), 48): yield from ex.map(one, todo[i:i + 48])

    with cf.ThreadPoolExecutor(a.jobs) as ex:
        for n, (t, x, f) in enumerate(results(ex), 1):
            if f is None: print(f"skip {t['id']}", file=sys.stderr); continue
            out[t["id"]] = f
            if clap: clap.add(clip48(x)); keep.append(f)
            if n % 50 == 0: print(f"dsp {n}/{len(todo)}", file=sys.stderr, flush=True)
    ids = list(out)
    if clap and keep:
        emb = clap.finish(keep)
        q = np.clip(np.round(emb * 127 / np.abs(emb).max(1, keepdims=True)), -127, 127).astype(np.int8)
        open(a.out + ".clap.bin", "wb").write(q.tobytes())
    # allow_nan=False: browsers reject the whole file on one NaN, so fail here instead.
    json.dump({"ids": ids, "dims": 512 if a.clap else 0, "features": out}, open(a.out, "w"), default=float, allow_nan=False)
    print(f"done {len(ids)}/{len(todo)}", file=sys.stderr)


if __name__ == "__main__":
    main()
