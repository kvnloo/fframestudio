# Sound Atlas — native GPUI experiment

A ~250-line native port of the web Sound Atlas (`web/src/music-atlas/`). It includes the radial feel/tempo atlas, a type-to-filter virtual list, keyboard controls and a rodio player bar. It reads the same `catalog.json` the web app ships.

```sh
cargo build --release -j3          # cold ~5–10 min, incremental ~30–45 s
./target/release/sound-atlas-gpui path/to/catalog.json
```

Env hooks (no synthetic input needed):
- `SA_SELFTEST=<query>`: filter, play the first hit, log the playback position.
- `SA_BENCH=1`: scripted boot → idle → scroll 240 frames → 5 filters → play, printing `BENCH` markers.
- `SA_BASE=<url>`: audio base URL (point at a local mirror).

## Benchmark vs the web app (`bench/`)
`node bench/mirror.mjs` mirrors prod locally. `python3 -I bench/harness.py 5` runs alternating GPUI/Chrome journeys on the same GPU; set `WL=1` for a headless Sway. `bench/report.py` prints medians.

Summary (2026-11-12, 5 runs/side): GPUI idles at 13–20× less CPU, uses ~3.5× less memory, runs as 1 process instead of 11, and starts audio 5–15× faster after a click (51 ms). Scroll p95 frame time and time-to-first-frame tie. On Wayland the cpal ALSA output thread dominates playback CPU, which is still unexplained.

Verdict: worth keeping as a desktop companion, not as a replacement for the web product. GPUI has no phone/TV target.
