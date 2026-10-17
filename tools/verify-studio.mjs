#!/usr/bin/env node
// Owned browser/bridge, copied source project, synthetic audio only in a labelled fixture.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
const repo = path.resolve(new URL("..", import.meta.url).pathname);
const out = path.resolve(process.env.FFS_EVIDENCE || "verify-out/studio");
await fs.mkdir(out, { recursive: true });
const home = await fs.mkdtemp(
  path.join(process.env.TMPDIR || os.tmpdir(), "ffs-studio-"),
);
const env = {
  ...process.env,
  HOME: home,
  FFS_SOURCES: path.join(repo, "projects/sources.example.json"),
};
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: repo, env, encoding: "utf8" });
  if (r.status) throw Error(r.stderr);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = path.join(
  os.homedir(),
  "fframestudio/projects/expresslane-i880",
);
const before = hash(await fs.readFile(path.join(source, "project.json")));
let bridge, browser;
const report = { screenshots: [], checks: {}, errors: [] };
try {
  run("python3", ["tools/make_demo.py"]);
  run("python3", ["tools/import_projects.py"]);
  const library = path.join(home, "fframestudio");
  await fs.cp(source, path.join(library, "projects/expresslane-i880"), {
    recursive: true,
  });
  // Explicit, separately named audio fixture proves worker peaks and playback. Not the real project.
  const fixture = JSON.parse(
    await fs.readFile(path.join(library, "projects/demo/project.json"), "utf8"),
  );
  fixture.id = "audio-fixture";
  fixture.title = "Audio waveform test fixture";
  fixture.media = {};
  fixture.renders = [];
  fixture.music = {
    file: "tone.wav",
    title: "Verification tone",
    author: "Generated test signal",
    bpm: 120,
    beats: Array.from({ length: 24 }, (_, i) => i * 0.5),
  };
  const fixtureDir = path.join(library, "projects/audio-fixture");
  await fs.mkdir(fixtureDir);
  await fs.writeFile(
    path.join(fixtureDir, "project.json"),
    JSON.stringify(fixture),
  );
  run("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=16000",
    "-t",
    "12",
    path.join(fixtureDir, "tone.wav"),
  ]);
  // Bridge uses the library index for cards, not a project-directory scan.
  const indexPath = path.join(library, "projects/library.json"),
    index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const real = JSON.parse(
    await fs.readFile(path.join(source, "project.json"), "utf8"),
  );
  index.projects.push({
    id: real.id,
    title: real.title,
    kind: real.kind,
    poster: real.media?.poster ? real.id + "/" + real.media.poster : null,
    duration_s: real.duration_s || Math.max(...real.shots.map((s) => s.t1)),
    shots: real.shots.length,
    renders: real.renders?.length || 0,
    tags: real.tags || [],
  });
  await fs.writeFile(indexPath, JSON.stringify(index));
  const port = await new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  bridge = spawn(
    process.execPath,
    [
      "bridge/bridge.mjs",
      "--port",
      String(port),
      "--root",
      library,
      "--no-config",
    ],
    { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  bridge.stdout.on("data", (d) => (log += d));
  bridge.stderr.on("data", () => {});
  for (let n = 0; n < 300 && !log.includes("open the studio:"); n++)
    await new Promise((r) => setTimeout(r, 50));
  const url = log.match(/open the studio: (\S+)/)?.[1];
  if (!url) throw Error("Owned bridge did not start");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || "/usr/bin/chromium",
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector(".card");
  const base = new URL("/", page.url()).href;
  const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, name + ".png") });
    report.screenshots.push(name + ".png");
  };
  for (const theme of ["studio", "paper"]) {
    await page.goto(base);
    await page.waitForSelector("#library-theme");
    await page.selectOption("#library-theme", theme);
    await page.waitForFunction(() =>
      [...document.images].every((i) => i.complete),
    );
    await shot("library-" + theme);
    for (const id of ["demo", "expresslane-i880"]) {
      await page.goto(base + "#/p/" + id);
      await page.waitForFunction(
        (id) => window.ffs?.doc.id === id && window.ffs.interactiveAt,
        id,
      );
      await page.waitForTimeout(1100);
      await page.waitForFunction(
        () =>
          !["pending", "decoding"].includes(window.ffs.studio.analysisState),
      );
      await page.evaluate(() => window.ffs.seek(0));
      await shot(id + "-" + theme);
      if (id === "demo") {
        await page.click('[data-slate-tab="direction"]');
        await shot("demo-direction-" + theme);
      }
      if (id === "expresslane-i880") {
        report.checks.realClips = await page.locator(".timeline-clip").count();
        report.checks.realPalette = await page
          .locator(".timeline-clip")
          .evaluateAll((ns) => [...new Set(ns.map((n) => n.dataset.colour))]);
        if (
          report.checks.realClips !== real.shots.length ||
          report.checks.realPalette.length !== 5
        )
          throw Error("Real shot count or palette missing");
        await page.click('[data-slate-tab="shot"]');
        await shot("expresslane-slate-" + theme);
        const narrow = await page
          .locator(".timeline-clip")
          .evaluateAll(
            (ns) =>
              ns.reduce((a, n) =>
                n.getBoundingClientRect().width <
                a.getBoundingClientRect().width
                  ? n
                  : a,
              ).dataset.select,
          );
        await page.locator(`.timeline-clip[data-select="${narrow}"]`).click();
        if ((await page.evaluate(() => window.ffs.selection)) !== narrow)
          throw Error("Narrow timeline shot could not be selected");
        report.checks.narrowShotSelection = true;
        await page.click('[data-slate-tab="narrative"]');
        if (!(await page.locator("#narrative-pane blockquote").isVisible()))
          throw Error("Narrative hidden");
      }
    }
  }
  await page.goto(base + "#/p/demo");
  await page.waitForFunction(
    () => window.ffs?.doc.id === "demo" && window.ffs.interactiveAt,
  );
  await page.click('[data-action="loop-shot"]');
  await page.evaluate(() => {
    window.ffs.seek(window.ffs.clip.start + window.ffs.clip.duration - 1);
    window.ffs.rate = 1;
  });
  await page.waitForTimeout(200);
  if (
    !(await page.evaluate(
      () => window.ffs.frame < window.ffs.clip.start + window.ffs.clip.duration,
    ))
  )
    throw Error("Shot did not loop");
  report.checks.loopShot = true;
  await page.click('[data-action="pause"]');
  await page.click('[data-action="loop-film"]');
  await page.evaluate(() => {
    window.ffs.seek(window.ffs.total - 1);
    window.ffs.rate = 1;
  });
  await page.waitForTimeout(200);
  report.checks.loopFilmState = await page.evaluate(() => ({
    frame: window.ffs.frame,
    total: window.ffs.total,
    duration: window.ffs.clip.duration,
    loop: window.ffs.studio.loop,
    rate: window.ffs.rate,
    bounds: window.ffs.studio.bounds(),
  }));
  if (
    !(await page.evaluate(
      () => window.ffs.frame < window.ffs.clip.start + window.ffs.clip.duration,
    ))
  )
    throw Error("Film did not loop");
  report.checks.loopFilm = true;
  await page.click('[data-action="pause"]');
  await page.click('[data-action="mute"]');
  if (await page.locator("#preview-video").evaluate((v) => v.muted))
    throw Error("Mute toggle failed");
  report.checks.mute = true;
  await page.click('[data-action="screening"]');
  await page.waitForFunction(() => document.fullscreenElement?.id === "canvas");
  await shot("screening-room");
  await page.evaluate(() => document.exitFullscreen());
  report.checks.screeningRoom = true;
  await page.goto(base + "#/p/audio-fixture");
  await page.waitForFunction(() => window.ffs?.studio.peaks?.length === 1400);
  report.checks.audioPeaks = await page.evaluate(() => ({
    peaks: window.ffs.studio.peaks.length,
    nonzero: [...window.ffs.studio.peaks].some((x) => x > 0),
    energy: [...window.ffs.studio.energy].some((x) => x > 0),
    visible: !document.querySelector("#audio-wave").hidden,
  }));
  if (!Object.values(report.checks.audioPeaks).every(Boolean))
    throw Error("Waveform missing");
  await shot("audio-waveform-fixture");
  await page.reload();
  await page.waitForFunction(() => window.ffs?.studio.peaks?.length === 1400);
  report.checks.audioCache = await page.evaluate(
    () => window.ffs.studio.waveCached === true,
  );
  if (!report.checks.audioCache)
    throw Error("Waveform was not served from cache");
  // Existing legacy themes remain exact tokens.
  await page.click('[data-action="settings"]');
  await page.selectOption("#theme", "light");
  report.checks.legacyLight = await page.evaluate(
    () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim() === "#f1f0e9",
  );
  await page.selectOption("#theme", "contrast");
  report.checks.legacyContrast = await page.evaluate(
    () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim() === "#000",
  );
  report.checks.sourceUnchanged =
    before === hash(await fs.readFile(path.join(source, "project.json")));
  if (
    report.errors.length ||
    !report.checks.sourceUnchanged ||
    !report.checks.legacyLight ||
    !report.checks.legacyContrast
  )
    throw Error(JSON.stringify(report));
  report.ok = true;
} catch (e) {
  report.ok = false;
  report.error = e.stack;
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (bridge && bridge.exitCode === null) {
    bridge.kill("SIGTERM");
    await once(bridge, "exit");
  }
  report.home = home;
  await fs.writeFile(
    path.join(out, "studio-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
