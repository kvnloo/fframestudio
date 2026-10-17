# Standalone engine qualification spike

**Start with [REPORT.md](REPORT.md): neither compositor passed the shipping gates.**
`adapter.ts` proposes the replaceable boundary; it is not a production implementation.

## Run locally

Requires the media locations given to this task, repository fonts, Node/npm, `uv`, native `ffmpeg`/`ffprobe`, and `/usr/bin/chromium`. `native.py` also requires the existing One Take executable and its runtime assets. No fixtures or outputs are uploaded.

```sh
cd spike/engine
npm ci --ignore-scripts
python prepare.py
npm run dev
```

The dev server binds **127.0.0.1:5197**, supplies COOP/COEP, and accepts generated receipts into `artifacts/`. Do not expose it publicly. Pages:

- `/`: WebAV; console API `await lab.init()`, `await lab.snapshot(8.5)`.
- `/alternative.html`: Diffusion evaluation, watermark retained.
- `/performance.html`: bounded export/accumulation fixture.

In another terminal, run **sequentially**, not as competing benchmark processes:

```sh
uv run --with playwright --with psutil python run.py
uv run --with playwright --with psutil python run_alternative.py
uv run --with numpy --with pillow python verify_seek.py
uv run --with selenium python firefox_probe.py
uv run --with playwright python run_performance.py
python native.py
python native_gpu.py
uv run --with playwright python final_export.py
uv run --with playwright python measure_playback.py
uv run --with numpy python verify_av.py
python verify_outputs.py
python research.py             # authenticated gh; public upstream metadata
python aggregate.py
```

The first two runners include real **five-minute** scrub tests. Browser jobs have explicit timeouts and write partial results after each stage. Stock Firefox uses Selenium because it is not Playwright-patched. Native rendering is headless; do not invoke either project's native `preview` command on the working desktop.

`run_alternative.py` exercises direct and settled seeks independently. `final_export.py` makes the final calibrated film and additional output configurations. `run_performance.py` uses a separate two-second source-pattern/moving-square workload; its result must not be compared to a real-media composition without labeling the workload. `native_gpu.py` demonstrates the required input-rate normalization for the fframes master and tests real NVENC, not just encoder availability.

The committed receipts were collected before and after the title-unit/calibration-placement correction documented in REPORT. Rerunning current code uses the corrected title and marker placement throughout; do not overwrite historical receipts and describe them as the original run. `aggregate.py` deliberately replaces the evidence directory's named numerical receipts when invoked.

## Checks

```sh
npm run build
npx tsc --noEmit --strict --skipLibCheck --lib ES2022,DOM adapter.ts
python -m compileall -q . -x 'node_modules|dist'
npm audit
```

`skipLibCheck` is needed for an upstream duplicate DOM/WebCodecs declaration conflict; the adapter itself is checked strictly. The production bundle excludes `public/` copies so private test media cannot accidentally become a build artifact. Use the dev server for this harness; the build is a compilation check, not a deployable media demo.

## Files and evidence

- `main.js`: WebAV composition, codec probes, source seeking, playback, export and scrub API.
- `alternative.js`: corresponding Diffusion evaluation; keeps watermark and performs no key bypass.
- `performance.js`: custom IClip temporal accumulation over reused WebAV sprites; no new codec/muxer.
- Python runners/verifiers: real browser/native execution, independent pixel/A/V validation and numeric aggregation.
- `evidence/`: committed JSON receipts, all 50 seek rows per path, memory samples, codec/GPU reports, ffprobe data, first-party metadata and artifact hashes.
- `artifacts/`: ignored real MP4/MKV/PNG files and logs; retain locally for review.
- `public/media/`: ignored symlinks and explicitly generated calibration/source fixtures.
- `package-lock.json`: exact dependency resolution.

Do not copy private project media, generated footage, fonts or music into Git. A pinned library licence does not grant redistribution rights to fixture assets. No live editor/document code is changed by this spike.
