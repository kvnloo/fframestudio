import { fpsOf, textOf } from "./doc/project.js";
import { FittedLayout } from "./fitted-layout.js";
import { request, preferences as storage } from "./host.js";
const panelTabs = ["shot", "narrative", "direction", "takes", "assistant", "source", "story"];
export const escapeHTML = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function colourSlot(value) {
  const known = {
    S: 0,
    H: 1,
    M: 2,
    R: 3,
    T: 4,
    P: 0,
    N: 2,
    Q: 1,
    DROP: 3,
    A: 4,
    CAM: 1,
    END: 4,
    MONT: 2,
    BAR: 2,
    BRK: 3,
    IDX: 1,
    CLOCK: 2,
    video: 0,
    image: 1,
    text: 2,
    audio: 4,
  };
  if (Object.hasOwn(known, value)) return known[value];
  let hash = 0;
  for (const c of String(value || "shot"))
    hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(hash) % 5;
}
export function clipKind(c) {
  return (
    c.metadata?.type ||
    c.metadata?.kind ||
    c.metadata?.chapter ||
    (c.styleId !== "default" ? c.styleId : null) ||
    c.name
  );
}
export function advanceFrame(frame, step, total, loop = null) {
  const next = frame + step;
  if (loop && (next >= loop[1] || next < loop[0]))
    return step > 0 ? loop[0] : loop[1] - 1;
  return Math.max(0, Math.min(total - (loop ? 0 : 1), next));
}
export function tempoOf(beats, fps, supplied) {
  if (Number.isFinite(Number(supplied)) && Number(supplied) > 0)
    return Number(supplied);
  const gaps = beats
    .slice(1)
    .map((b, i) => b - beats[i])
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  return gaps.length
    ? Math.round((600 * fps) / gaps[Math.floor(gaps.length / 2)]) / 10
    : null;
}
export function timecode(frame, fps) {
  const seconds = Math.floor(Math.max(0, frame) / fps);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}:${String(Math.floor(frame % fps)).padStart(2, "0")}`;
}
const esc = escapeHTML;
const $ = (s) => document.querySelector(s);
const put = (selector, value) => {
  const n = $(selector);
  if (n && n.textContent !== value) n.textContent = value;
};
export class StudioView {
  constructor(editor) {
    this.e = editor;
    this.tab = "shot";
  }
  mount() {
    const e = this.e;
    e.root.classList.add("film-workspace");
    $(".ph-title .cap").textContent = "CUT / EDITORIAL";
    const metadata = document.createElement("div");
    metadata.className = "cut-meta";
    metadata.innerHTML =
      '<span class="cap">RUNTIME <b id="cut-runtime"></b></span><span class="cap">DIRECTION <b id="cut-direction"></b></span>';
    $(".ph-title").append(metadata);

    $(".inspector-panel>.panel-title").firstChild.textContent = "Film slate ";
    const tabs = document.createElement("div");
    tabs.className = "slate-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Editorial panels");
    tabs.innerHTML = panelTabs
      .map(
        (t) =>
          `<button role="tab" id="tab-${t}" aria-controls="${t === "shot" ? "inspector" : t + "-pane"}" aria-selected="${t === "shot"}" data-slate-tab="${t}">${t}</button>`,
      )
      .join("");
    $("#inspector").before(tabs);
    $("#inspector").setAttribute("role", "tabpanel");
    $("#inspector").setAttribute("aria-labelledby", "tab-shot");
    for (const t of panelTabs.filter(t => t !== "shot")) {
      const n = document.createElement("div");
      n.id = t + "-pane";
      n.className = "slate-pane";
      n.hidden = true;
      n.setAttribute("role", "tabpanel");
      n.setAttribute("aria-labelledby", "tab-" + t);
      $(".inspector-panel").append(n);
    }
    tabs.onclick = (ev) => {
      const t = ev.target.dataset.slateTab;
      if (t) this.showTab(t);
    };
    tabs.onkeydown = (ev) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
      ev.preventDefault();
      const ts = panelTabs.filter(t => t !== "story" || innerWidth < 1024);
      this.showTab(
        ts[
          ev.key === "Home"
            ? 0
            : ev.key === "End"
              ? ts.length - 1
              : (ts.indexOf(this.tab) + (ev.key === "ArrowRight" ? 1 : ts.length - 1)) % ts.length
        ],
      );
      $("#tab-" + this.tab).focus();
    };
    const hud = document.createElement("div");
    hud.className = "poster-hud";
    hud.innerHTML =
      '<span id="poster-brand"></span><span class="status-chip" id="poster-status">EDITORIAL PREVIEW</span><span id="poster-beat"></span><span id="poster-time"></span><span class="poster-shot" id="poster-shot"></span>';
    $("#canvas").append(hud);
    const transport = $(".transport");
    const info = document.createElement("span");
    info.id = "shot-readout";
    info.className = "cap";
    transport.insertBefore(info, $("#seek"));
    const controls = document.createElement("div");
    controls.className = "screening-tools";
    controls.innerHTML = ["loop-shot", "loop-film", "mute", "screening"]
      .map(
        (a, i) =>
          `<button class="pill" data-action="${a}" ${i < 3 ? 'aria-pressed="' + (a === "mute") + '"' : ""}>${["Loop shot", "Loop film", "Mute", "Screening room"][i]}</button>`,
      )
      .join("");
    transport.insertBefore(controls, $("#seek"));
    const ruler = document.createElement("div");
    ruler.id = "film-ruler";
    $("#timeline-space").prepend(ruler);
    const chapters = document.createElement("div");
    chapters.id = "chapters";
    $("#lane").before(chapters);
    const wave = document.createElement("canvas");
    wave.id = "audio-wave";
    wave.width = 1400;
    wave.height = 44;
    wave.hidden = true;
    $("#timeline-space").append(wave);
    const footer = document.createElement("div");
    footer.className = "film-footer";
    footer.innerHTML =
      '<span id="music-credit"></span><span id="film-stats"></span>';
    $("#timeline").after(footer);
    const hint = document.createElement("div");
    hint.className = "slate-keyhint";
    hint.innerHTML =
      "<kbd>space</kbd> play · <kbd>← →</kbd> frames · <kbd>↑ ↓</kbd> shots<br><kbd>I / O</kbd> trim · <kbd>S</kbd> split · <kbd>⌘ K</kbd> commands";
    $(".inspector-panel").append(hint);
    this.muted = true;
    this.audio = new Audio();
    this.audio.muted = true;
    this.audio.preload = "metadata";
    // Media analysis is deliberately off the cold-open path.
    this.analysisState = "pending";
    this.audioTimer = setTimeout(() => this.loadAudio(), 750);
    this.layout = new FittedLayout(e);
    this.layout.mount();
    this.showTab(e.settings.slateTab || (e.doc.metadata?.direction ? "direction" : "shot"));
  }
  showTab(tab) {
    if (!panelTabs.includes(tab) || (tab === "story" && innerWidth >= 1024)) tab = "shot";
    this.tab = tab;
    for (const t of panelTabs) {
      $("#tab-" + t).setAttribute("aria-selected", String(t === tab));
      $("#tab-" + t).tabIndex = t === tab ? 0 : -1;
      $(t === "shot" ? "#inspector" : "#" + t + "-pane").hidden = t !== tab;
    }
    this.e.settings.slateTab = tab;
    storage.setItem("ffs.settings", JSON.stringify(this.e.settings));
    this.inspector();
  }
  inspector() {
    const e = this.e,
      c = e.clip;
    if (!c) return;
    if (this.tab === "direction") {
      const direction = e.doc.metadata?.direction || {},
        styles = e.video.styles;
      const sig = JSON.stringify([
        direction,
        styles,
        e.doc.canvas,
        e.doc.fps,
        this.palette,
      ]);
      if (this.directionSig === sig) return;
      this.directionSig = sig;
      $("#direction-pane").innerHTML =
        `<div class="slate-heading"><span class="cap">The film's look</span><h2>Art <em>direction.</em></h2><p>Project settings, not invented presets.</p></div><div class="direction-cards">${Object.entries(
          direction,
        )
          .map(
            ([k, v], i) =>
              `<article class="direction-card" data-colour="${i % 5}"><div class="paper-top"><span class="cap">${esc(k)}</span><strong>${esc(v)}</strong><em>${esc(k === "brand" ? "A name for this story." : k === "style" ? "The visual language." : "Part of this film’s direction.")}</em></div><div class="card-note">PROJECT DIRECTION · ${esc(k)}<br><span>Read from the source specification</span></div></article>`,
          )
          .join("")}${Object.entries(styles)
          .map(
            ([id, s], i) =>
              `<button class="direction-card style-choice" data-style-choice="${esc(id)}" data-colour="${i % 5}"><div class="paper-top"><span class="cap">Shared typography</span><strong>${esc(id)}</strong><em>Words that carry the film.</em><i class="style-swatch" style="--sample:${esc(/^#[\da-f]{6}$/i.test(s.color) ? s.color : "#ecebe7")}"></i></div><div class="card-note">EDIT SHARED STYLE ↗<br><span>All shots using ${esc(id)}</span></div></button>`,
          )
          .join(
            "",
          )}<article class="direction-card" data-colour="1"><div class="paper-top"><span class="cap">Format</span><strong>${fpsOf(e.doc)}<small> FPS</small></strong><em>${e.doc.canvas.width} × ${e.doc.canvas.height}</em></div><div class="card-note">THE FRAME<br><span>Native project dimensions</span></div></article><article class="direction-card" data-colour="2"><div class="paper-top"><span class="cap">${this.palette ? "Poster study" : "Shot language"}</span><strong>Colour.</strong><div class="palette-swatches">${(this.palette || []).map((x) => `<i style="--sample:${x}"></i>`).join("") || [0, 1, 2, 3, 4].map((x) => `<i data-colour="${x}"></i>`).join("")}</div><em>${this.palette ? "Sampled from this film’s poster." : "A colour for every kind of shot."}</em></div><div class="card-note">${this.palette ? "POSTER PALETTE" : "EDITORIAL PALETTE"}<br><span>${this.palette ? "Source image, sampled once" : "No poster available to sample"}</span></div></article></div>`;
      $("#direction-pane").onclick = (ev) => {
        const id = ev.target.closest("[data-style-choice]")?.dataset
          .styleChoice;
        if (!id) return;
        const clip = e.video.clips.find((c) => c.styleId === id);
        if (clip)
          e.select(clip.id).then(() => {
            this.showTab("shot");
            $("#inspector details").open = true;
            $("#style-color").focus();
          });
      };
    }
    if (this.tab === "narrative") {
      const scene = e.video.scenes.find((s) => s.clipIds.includes(c.id));
      const sig = JSON.stringify([c.id, textOf(c), scene]);
      if (this.narrativeSig === sig) return;
      this.narrativeSig = sig;
      $("#narrative-pane").innerHTML =
        `<div class="slate-heading"><span class="cap">${esc(scene?.name || "Story beat")}</span><h2>The <em>narrative.</em></h2></div><div class="narrative-paper"><span class="cap">${esc(c.name)}</span><blockquote>${esc(Object.values(textOf(c)).flat().join(" ")) || "This shot has no words yet."}</blockquote><p>${esc(c.metadata?.chapter || "Ungrouped shot")} · ${esc(c.metadata?.bars || "—")} bars</p></div><button class="pill" data-action="edit-text">Edit this shot’s words ↗</button><p class="hint">Words are edited in Shot. Changes are scoped to the selected shot and can be undone.</p>`;
    }
  }
  timeline() {
    const e = this.e,
      fps = fpsOf(e.doc),
      min = e.timelineScroll / e.scale,
      max = (e.timelineScroll + e.timelineWidth) / e.scale;
    const sig = JSON.stringify([
      e.videoId,
      e.scale,
      e.total,
      min,
      e.video.scenes,
      e.video.clips.map((c) => [c.id, c.start, c.duration, clipKind(c)]),
    ]);
    if (sig === this.timelineSig) return;
    this.timelineSig = sig;
    const step = Math.max(1, Math.ceil((max - min) / fps / 12 / 5) * 5),
      ticks = [];
    for (let s = Math.ceil(min / fps / step) * step; s * fps <= max; s += step)
      ticks.push(
        `<span style="left:${s * fps * e.scale}px">${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</span>`,
      );
    $("#film-ruler").innerHTML = ticks.join("");
    $("#chapters").innerHTML = e.video.scenes
      .flatMap((s, i) => {
        const clips = e.video.clips.filter((c) => s.clipIds.includes(c.id));
        if (!clips.length) return [];
        const start = Math.min(...clips.map((c) => c.start)),
          end = Math.max(...clips.map((c) => c.start + c.duration));
        return end < min || start > max
          ? []
          : [
              `<span title="${esc(s.name)}" style="left:${start * e.scale}px;width:${(end - start) * e.scale}px">${String(i + 1).padStart(2, "0")} ${esc(s.name)}</span>`,
            ];
      })
      .join("");
    const music = e.doc.metadata?.music,
      bpm = tempoOf(e.video.beats, fps, music?.bpm),
      authoredBars = e.video.clips.every((c) =>
        Number.isFinite(c.metadata?.bars),
      )
        ? e.video.clips.reduce((sum, c) => sum + c.metadata.bars, 0)
        : null,
      bars =
        authoredBars || (bpm ? Math.ceil(((e.total / fps) * bpm) / 240) : null);
    put(
      "#music-credit",
      music
        ? `${music.title || "Soundtrack"} · ${music.author || "Unknown artist"}${bpm ? " · " + bpm + " BPM" : ""}${e.video.beats.length ? " · BEATS DETECTED" : ""}${e.doc.media.some((m) => m.kind === "audio") ? "" : " · TRACK METADATA"}`
        : e.video.beats.length
          ? "BEAT GRID · " +
            e.video.beats.length +
            " MARKERS" +
            (bpm ? " · " + bpm + " BPM" : "")
          : this.peaks
            ? (this.waveSource || "Audio").toUpperCase() + " · MEASURED WAVEFORM"
            : "SHOT MARKERS · NO AUDIO TRACK",
    );
    put(
      "#film-stats",
      `FILM ${timecode(e.total, fps).slice(0, -3)} · ${e.video.clips.length} SHOTS${bars ? " · " + bars + " BARS" : ""}`,
    );
    put("#cut-runtime", timecode(e.total, fps).slice(0, -3));
    put(
      "#cut-direction",
      Object.values(e.doc.metadata?.direction || {})
        .slice(0, 3)
        .join(" · ") || "Original look",
    );
    if (!e.video.beats.length)
      $("#beats").innerHTML = e.video.clips
        .filter((c) => c.start >= min && c.start <= max)
        .map(
          (c) => `<i style="transform:translateX(${c.start * e.scale}px)"></i>`,
        )
        .join("");
    this.drawWave();
  }
  preview(c) {
    const e = this.e,
      fps = fpsOf(e.doc),
      music = e.doc.metadata?.music,
      bpm = tempoOf(e.video.beats, fps, music?.bpm),
      index = e.video.clips.indexOf(c);
    const poster = !c.mediaId && !c.thumb;
    $("#canvas").classList.toggle("poster-mode", poster);
    put(
      "#poster-brand",
      (e.doc.metadata?.direction?.brand
        ? e.doc.metadata.direction.brand + " · "
        : "") + e.doc.title,
    );
    put(
      "#poster-status",
      e.doc.metadata?.kind === "studio-spec"
        ? "PROTOTYPE · SOURCE SPEC"
        : "EDITORIAL PREVIEW",
    );
    put(
      "#poster-beat",
      bpm
        ? `${bpm} BPM · BAR ${String(Math.floor(((e.frame / fps) * bpm) / 240) + 1).padStart(3, "0")}`
        : `${fps} FPS · ${e.doc.canvas.width} × ${e.doc.canvas.height}`,
    );
    put("#poster-time", timecode(e.frame, fps));
    put(
      "#poster-shot",
      `${String(index + 1).padStart(2, "0")} / ${e.video.clips.length} · ${c.name}`,
    );
    put(
      "#shot-readout",
      `${index + 1}/${e.video.clips.length} · ${c.name}${c.metadata?.bars ? " · " + c.metadata.bars + " bars" : ""}`,
    );
    put("#time", timecode(e.frame, fps));
    $("#time").title = `${Math.floor(e.frame)} f / ${e.total} f`;
    put('[data-action="play"]', e.rate ? "Ⅱ PAUSE" : "▶ PLAY");
    if (this.audio.src) {
      const target = this.audioSourceIn + Math.max(0, (e.frame - this.audioStart) / fps);
      if (Math.abs(this.audio.currentTime - target) > 0.25)
        this.audio.currentTime = target;
      this.audio.playbackRate = Math.max(
        0.0625,
        Math.min(16, Math.abs(e.rate) || 1),
      );
      if (e.rate > 0 && e.frame >= this.audioStart && e.frame < this.audioEnd)
        this.audio.play().catch(() => {});
      else this.audio.pause();
    }
  }
  async action(a) {
    const e = this.e;
    if (a === "loop-shot" || a === "loop-film") {
      this.loop = this.loop === a ? null : a;
      for (const k of ["loop-shot", "loop-film"])
        $(`[data-action="${k}"]`).setAttribute(
          "aria-pressed",
          String(this.loop === k),
        );
      return true;
    }
    if (a === "mute") {
      this.muted = !this.muted;
      this.audio.muted = this.muted;
      $("#preview-video").muted = this.muted || !!this.audio.src;
      $('[data-action="mute"]').setAttribute(
        "aria-pressed",
        String(this.muted),
      );
      return true;
    }
    if (a === "screening") {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("#canvas").requestFullscreen();
      return true;
    }
    return false;
  }
  bounds() {
    const e = this.e,
      c = e.clip;
    return this.loop === "loop-shot" && c
      ? [c.start, c.start + c.duration]
      : [0, e.total];
  }
  async loadAudio() {
    const e = this.e;
    const owner = e.video.clips.find((c) =>
      c.attached.some((a) => a.kind === "audio"),
    );
    const attachment = owner?.attached.find((a) => a.kind === "audio");
    const media = e.doc.media.find((m) => m.id === attachment?.mediaId);
    this.audioStart = owner ? owner.start + attachment.offset : 0;
    this.audioEnd = this.audioStart + (attachment?.duration || 0);
    this.audioSourceIn = Number(e.doc.metadata?.music?.starts_at_s) || 0;
    this.samplePoster();
    const analysisFile = media?.file || e.doc.preview.proxy;
    if (!analysisFile || e.dead) {
      this.analysisState = "absent";
      return;
    }
    this.analysisState = "decoding";
    this.waveStart = media ? this.audioStart : 0;
    this.waveDuration = media ? attachment.duration : e.total;
    this.waveSource = media ? "soundtrack" : "source proxy audio";
    if (media) {
      this.audio.src = e.url(media.file);
      this.audio.load();
    }
    this.waveWorker = new Worker("/app/src/wave-worker.js", { type: "module" });
    this.waveWorker.onmessage = ({ data }) => {
      if (e.dead) return;
      if (data.error) {
        put(
          "#music-credit",
          (e.doc.metadata?.music?.title || "Audio") + " · WAVEFORM UNAVAILABLE",
        );
        return;
      }
      this.analysisState = "ready";
      this.waveCached = data.cached;
      this.peaks = data.peaks;
      this.energy = data.energy;
      $("#audio-wave").hidden = false;
      $("#audio-wave").setAttribute(
        "aria-label",
        "Measured " + this.waveSource + " peaks and RMS energy",
      );
      put(
        "#music-credit",
        (e.doc.metadata?.music
          ? [
              e.doc.metadata.music.title,
              e.doc.metadata.music.author,
              e.doc.metadata.music.bpm
                ? e.doc.metadata.music.bpm + " BPM"
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : "SOURCE PROXY AUDIO") + " · MEASURED WAVEFORM",
      );
      this.drawWave();
    };
    try {
      const bytes = await request(e.url(analysisFile)).then((r) => {
        if (!r.ok) throw Error("Audio unavailable");
        return r.arrayBuffer();
      });
      if (e.dead) return;
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const key =
        e.url(analysisFile) +
        ":" +
        this.audioSourceIn + ":" + this.waveDuration + ":" +
        Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      this.audioContext = new AudioContext();
      const buffer = await this.audioContext.decodeAudioData(bytes);
      const start = media ? Math.round(this.audioSourceIn * buffer.sampleRate) : 0;
      const end = start + Math.round(this.waveDuration / fpsOf(e.doc) * buffer.sampleRate);
      const samples = buffer.getChannelData(0).slice(start, end);
      if (e.dead) return;
      this.waveWorker.postMessage({ key, samples }, [samples.buffer]);
      await this.audioContext.close();
    } catch {
      if (e.dead) return;
      this.analysisState = "unavailable";
      put(
        "#music-credit",
        (e.doc.metadata?.music?.title || "Source audio") +
          " · NO DECODABLE AUDIO · SHOT MARKERS",
      );
    }
  }
  async samplePoster() {
    const src = this.e.doc.preview.poster;
    if (!src) return;
    try {
      const img = new Image();
      img.src = this.e.url(src);
      await img.decode();
      if (this.e.dead) return;
      const canvas = document.createElement("canvas");
      canvas.width = 5;
      canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 5, 1);
      const data = ctx.getImageData(0, 0, 5, 1).data;
      this.palette = Array.from(
        { length: 5 },
        (_, i) =>
          "#" +
          [...data.slice(i * 4, i * 4 + 3)]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join(""),
      );
      this.inspector();
    } catch {
      /* No sampled palette is shown for an unavailable poster. */
    }
  }
  drawWave() {
    if (!this.peaks) return;
    const canvas = $("#audio-wave"),
      ctx = canvas.getContext("2d"),
      css = getComputedStyle(canvas),
      w = canvas.width,
      h = canvas.height;
    canvas.style.left = (this.waveStart || 0) * this.e.scale + "px";
    canvas.style.width = Math.max(1, this.waveDuration * this.e.scale) + "px";
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = css.getPropertyValue("--wave-ink");
    ctx.beginPath();
    for (let i = 0; i < this.peaks.length; i++) {
      let x = (i / this.peaks.length) * w,
        y = this.peaks[i] * h * 0.46;
      ctx.moveTo(x, h / 2 - y);
      ctx.lineTo(x, h / 2 + y);
    }
    ctx.stroke();
    ctx.strokeStyle = css.getPropertyValue("--amber");
    ctx.beginPath();
    for (let i = 0; i < this.energy.length; i++) {
      const x = (i / this.energy.length) * w,
        y = h - this.energy[i] * h;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  destroy() {
    this.layout?.destroy();
    clearTimeout(this.audioTimer);
    this.audio?.pause();
    this.audio?.removeAttribute("src");
    this.waveWorker?.terminate();
    if (this.audioContext?.state === "running") this.audioContext.close();
    this.e.root.classList.remove("film-workspace");
  }
}
