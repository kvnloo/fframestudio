// Composite the preview DIV onto a canvas. #canvas is not a media element, so it has no captureStream.
// Seeking pixels stay off the recording until the presented frame matches the editorial target.

import { fpsOf } from '../doc/project.js';
import { LIMITS, captureSupported } from './review.js';

const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
const AUDIO_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm'];

const INK = '#ff00c8';
const SEGMENT = 0x18538067;
const INFO = 0x1549A966;
const TIMECODE_SCALE = 0x2AD7B1;
const DURATION = 0x4489;
const SEGMENT_CHILD = new Set([0x114D9B74, INFO, 0x1F43B675, 0x1654AE6B, 0x1C53BB6B, 0x1941A469, 0x1043A770, 0x1254C367]);

export function mimeCandidates() { return MIME_CANDIDATES; }

function clipAt(editor, frame) {
  return editor.video.clips.find((clip) => frame >= clip.start && frame < clip.start + clip.duration) || null;
}

function expectedTime(editor, frame) {
  const clip = clipAt(editor, frame);
  if (!clip) return null;
  const fps = fpsOf(editor.doc);
  return (clip.sourceIn + ((frame - clip.start) * clip.speed.num) / clip.speed.den) / fps;
}

function usesProxy(editor, clip) {
  return !!(editor.doc.preview?.proxy && clip && clip.mediaId === editor.doc.media[0]?.id);
}

function concatBytes(chunks) {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readId(bytes, pos) {
  if (pos >= bytes.length || bytes[pos] === 0) return null;
  let width = 1;
  let marker = 0x80;
  while (width <= 8 && (bytes[pos] & marker) === 0) {
    marker >>= 1;
    width += 1;
  }
  if (width > 8 || pos + width > bytes.length) return null;
  let value = 0;
  for (let i = 0; i < width; i++) value = value * 256 + bytes[pos + i];
  return { width, value };
}

function readSize(bytes, pos) {
  if (pos >= bytes.length || bytes[pos] === 0) return null;
  let width = 1;
  let marker = 0x80;
  while (width <= 8 && (bytes[pos] & marker) === 0) {
    marker >>= 1;
    width += 1;
  }
  if (width > 8 || pos + width > bytes.length) return null;
  const payloadMask = marker - 1;
  let unknown = (bytes[pos] & payloadMask) === payloadMask;
  for (let i = 1; i < width; i++) if (bytes[pos + i] !== 0xff) unknown = false;
  let value = bytes[pos] & payloadMask;
  for (let i = 1; i < width; i++) value = value * 256 + bytes[pos + i];
  return { width, value, unknown };
}

function parseElement(bytes, pos, limit) {
  const id = readId(bytes, pos);
  if (!id) return null;
  const size = readSize(bytes, pos + id.width);
  if (!size) return null;
  const dataStart = pos + id.width + size.width;
  if (!size.unknown && (dataStart > limit || size.value > limit - dataStart)) return null;
  const dataEnd = size.unknown ? null : dataStart + size.value;
  return {
    id: id.value,
    idWidth: id.width,
    sizeWidth: size.width,
    size: size.value,
    unknown: size.unknown,
    start: pos,
    sizeStart: pos + id.width,
    dataStart,
    dataEnd,
    end: dataEnd,
  };
}

function encodeSize(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid EBML size');
  let width = 1;
  while (width < 8 && value > 2 ** (7 * width) - 2) width += 1;
  const out = new Uint8Array(width);
  let rest = value;
  for (let i = width - 1; i >= 0; i--) {
    out[i] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  out[0] |= 1 << (8 - width);
  return out;
}

function readUint(bytes, element) {
  if (!element || element.unknown || element.dataEnd - element.dataStart > 6) return null;
  let value = 0;
  for (let i = element.dataStart; i < element.dataEnd; i++) value = value * 256 + bytes[i];
  return value;
}

function readFloat(bytes, element) {
  if (!element || element.unknown) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + element.dataStart, element.dataEnd - element.dataStart);
  if (element.dataEnd - element.dataStart === 8) return view.getFloat64(0, false);
  if (element.dataEnd - element.dataStart === 4) return view.getFloat32(0, false);
  return null;
}

function buildDuration(value) {
  const body = new Uint8Array(8);
  new DataView(body.buffer).setFloat64(0, value, false);
  return concatBytes([new Uint8Array([0x44, 0x89]), encodeSize(8), body]);
}

function spliceBytes(bytes, start, end, insert) {
  const out = new Uint8Array(bytes.length - (end - start) + insert.length);
  out.set(bytes.subarray(0, start), 0);
  out.set(insert, start);
  out.set(bytes.subarray(end), start + insert.length);
  return out;
}

function parseExactChildren(bytes, start, end) {
  const children = [];
  let pos = start;
  while (pos < end) {
    const element = parseElement(bytes, pos, end);
    if (!element || element.unknown || element.end <= pos) return null;
    children.push(element);
    pos = element.end;
  }
  return pos === end ? children : null;
}

function locateInfo(bytes) {
  let pos = 0;
  let segment = null;
  while (pos < bytes.length) {
    const element = parseElement(bytes, pos, bytes.length);
    if (!element) return null;
    if (element.id === SEGMENT) {
      segment = element;
      break;
    }
    if (element.unknown) return null;
    pos = element.end;
  }
  if (!segment) return null;
  const segmentEnd = segment.unknown ? bytes.length : segment.dataEnd;
  let cursor = segment.dataStart;
  while (cursor < segmentEnd) {
    const element = parseElement(bytes, cursor, segmentEnd);
    if (!element) return null;
    if (element.id === INFO) {
      if (!element.unknown) return { segment, info: element, segmentEnd };
      const children = [];
      let childPos = element.dataStart;
      while (childPos < segmentEnd) {
        const child = parseElement(bytes, childPos, segmentEnd);
        if (!child || child.unknown) return null;
        if (SEGMENT_CHILD.has(child.id)) break;
        children.push(child);
        childPos = child.end;
      }
      return { segment, info: { ...element, dataEnd: childPos, end: childPos, unknown: false, scanned: true }, children, segmentEnd };
    }
    if (element.unknown) return null;
    cursor = element.end;
  }
  return null;
}

function durationMatches(bytes, expected) {
  const located = locateInfo(bytes);
  if (!located || located.info.unknown) return false;
  const children = located.children || parseExactChildren(bytes, located.info.dataStart, located.info.dataEnd);
  if (!children) return false;
  const duration = children.filter((element) => element.id === DURATION);
  if (duration.length !== 1) return false;
  const value = readFloat(bytes, duration[0]);
  if (!Number.isFinite(value) || Math.abs(value - expected) > 0.001) return false;
  if (!located.segment.unknown) {
    const declared = readSize(bytes, located.segment.sizeStart);
    if (!declared || declared.unknown || declared.value !== located.segment.dataEnd - located.segment.dataStart) return false;
  }
  return true;
}

// MediaRecorder WebM usually omits Duration, so the element reports Infinity until something
// plays it. Insert the measured take length into Info and patch known element sizes.
export function stampWebmDuration(bytes, durationMs) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16 || !Number.isFinite(durationMs) || durationMs <= 0) return bytes;
  if (bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return bytes;
  const located = locateInfo(bytes);
  if (!located) return bytes;
  const { segment, info } = located;
  const children = located.children || parseExactChildren(bytes, info.dataStart, info.dataEnd);
  if (!children) return bytes;
  const scaleElement = children.find((element) => element.id === TIMECODE_SCALE);
  const scale = scaleElement ? readUint(bytes, scaleElement) : 1_000_000;
  if (!Number.isFinite(scale) || scale <= 0) return bytes;
  const durationValue = durationMs * 1_000_000 / scale;
  if (!Number.isFinite(durationValue) || durationValue <= 0) return bytes;
  const parts = [];
  for (const child of children) {
    if (child.id === DURATION) continue;
    parts.push(bytes.subarray(child.start, child.end));
  }
  const durationElement = buildDuration(durationValue);
  let payloadLength = durationElement.length;
  for (const part of parts) payloadLength += part.length;
  let sizeField;
  try { sizeField = encodeSize(payloadLength); } catch { return bytes; }
  const stampedInfo = concatBytes([bytes.subarray(info.start, info.sizeStart), sizeField, ...parts, durationElement]);
  let out = spliceBytes(bytes, info.start, info.end, stampedInfo);
  const delta = stampedInfo.length - (info.end - info.start);
  if (!segment.unknown) {
    const dataLength = segment.dataEnd - segment.dataStart + delta;
    let newSize;
    try { newSize = encodeSize(dataLength); } catch { return bytes; }
    if (newSize.length === segment.sizeWidth) out.set(newSize, segment.sizeStart);
    else out = spliceBytes(out, segment.sizeStart, segment.sizeStart + segment.sizeWidth, newSize);
  }
  const tail = bytes.subarray(info.end);
  const stampedTail = out.subarray(out.length - tail.length);
  for (let i = 0; i < tail.length; i++) if (tail[i] !== stampedTail[i]) return bytes;
  if (!durationMatches(out, durationValue)) return bytes;
  return out;
}

async function blobWithDuration(blob, durationMs) {
  if (!blob?.size || !Number.isFinite(durationMs) || durationMs <= 0) return blob;
  try {
    const input = new Uint8Array(await blob.arrayBuffer());
    const output = stampWebmDuration(input, durationMs);
    if (output === input) return blob;
    return new Blob([output], { type: blob.type || 'video/webm' });
  } catch {
    return blob;
  }
}

function strokeInk(ctx, width, height, strokes, frame) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(3, width / 240);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.anchorFrame !== frame || !stroke.points?.length) continue;
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (stroke.points.length === 1) ctx.arc(stroke.points[0].x * width, stroke.points[0].y * height, ctx.lineWidth, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function cssAlpha(color) {
  if (!color || color === 'transparent') return 0;
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match) return 1;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

function transformText(text, mode) {
  if (mode === 'uppercase') return text.toLocaleUpperCase();
  if (mode === 'lowercase') return text.toLocaleLowerCase();
  if (mode === 'capitalize') return text.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
  return text;
}

function applyTextShadow(ctx, shadow, sx, sy) {
  if (!shadow || shadow === 'none') return;
  const color = shadow.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/);
  const lengths = shadow.match(/-?\d+(?:\.\d+)?px/g);
  if (!color || !lengths || lengths.length < 2) return;
  ctx.shadowColor = color[0];
  ctx.shadowOffsetX = parseFloat(lengths[0]) * sx;
  ctx.shadowOffsetY = parseFloat(lengths[1]) * sy;
  ctx.shadowBlur = lengths[2] ? parseFloat(lengths[2]) * ((sx + sy) / 2) : 0;
}

function mapRect(rect, playerRect, sx, sy) {
  return {
    x: (rect.left - playerRect.left) * sx,
    y: (rect.top - playerRect.top) * sy,
    w: rect.width * sx,
    h: rect.height * sy,
  };
}

function paintChrome(ctx, element, playerRect, sx, sy) {
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const box = element.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return false;
  const mapped = mapRect(box, playerRect, sx, sy);
  const radius = (parseFloat(style.borderTopLeftRadius) || 0) * ((sx + sy) / 2);
  const fill = style.backgroundColor;
  const borderWidth = parseFloat(style.borderTopWidth) || 0;
  const borderVisible = borderWidth > 0 && style.borderTopStyle !== 'none' && cssAlpha(style.borderTopColor) > 0;
  if (cssAlpha(fill) > 0 || borderVisible) {
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function' && radius > 0) ctx.roundRect(mapped.x, mapped.y, mapped.w, mapped.h, radius);
    else ctx.rect(mapped.x, mapped.y, mapped.w, mapped.h);
    if (cssAlpha(fill) > 0) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (borderVisible) {
      ctx.strokeStyle = style.borderTopColor;
      ctx.lineWidth = borderWidth * ((sx + sy) / 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  return true;
}

function paintTextElement(ctx, element, playerRect, sx, sy) {
  try {
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
  const box = element.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  const clip = mapRect(box, playerRect, sx, sy);
  const fontSize = parseFloat(style.fontSize) || 16;
  const lineHeight = parseFloat(style.lineHeight);
  const leading = Number.isFinite(lineHeight) ? Math.max(0, (lineHeight - fontSize) / 2) : 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const raw = node.textContent || '';
    if (raw.trim()) {
      const range = document.createRange();
      let lineStart = 0;
      let lineTop = null;
      let lineRect = null;
      const flush = (end) => {
        if (!lineRect || end <= lineStart) return;
        const piece = transformText(raw.slice(lineStart, end), style.textTransform);
        if (!piece.trim()) return;
        const mapped = mapRect(lineRect, playerRect, sx, sy);
        ctx.save();
        ctx.beginPath();
        ctx.rect(clip.x, clip.y, clip.w, clip.h);
        ctx.clip();
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${fontSize * sy}px ${style.fontFamily}`;
        ctx.fillStyle = style.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        if ('letterSpacing' in ctx) {
          const spacing = parseFloat(style.letterSpacing);
          if (Number.isFinite(spacing)) ctx.letterSpacing = `${spacing * sx}px`;
        }
        applyTextShadow(ctx, style.textShadow, sx, sy);
        ctx.fillText(piece, mapped.x, mapped.y + leading * sy);
        ctx.restore();
      };
      for (let i = 0; i < raw.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        if (lineTop == null) {
          lineTop = rect.top;
          lineRect = rect;
          continue;
        }
        if (Math.abs(rect.top - lineTop) > Math.max(1, rect.height * 0.5)) {
          flush(i);
          lineStart = i;
          lineTop = rect.top;
          lineRect = rect;
        } else {
          const left = Math.min(lineRect.left, rect.left);
          const top = Math.min(lineRect.top, rect.top);
          const right = Math.max(lineRect.right, rect.right);
          const bottom = Math.max(lineRect.bottom, rect.bottom);
          lineRect = { left, top, right, bottom, width: right - left, height: bottom - top };
        }
      }
      flush(raw.length);
    }
    node = walker.nextNode();
  }
  } catch {
    // A layout change while measuring line boxes must not stop the recording loop.
  }
}

export class PreviewCapture {
  constructor(editor) {
    this.editor = editor;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.hold = document.createElement('canvas');
    this.holdCtx = this.hold.getContext('2d', { alpha: false });
    this.shownFrame = null;
    this.presented = false;
    this.seekReady = false;
    this.paintedTime = null;
    this.rvfc = false;
    this.chunks = [];
    this.micChunks = [];
    this.bytes = 0;
    this.micBytes = 0;
    this.startedAt = 0;
    this.generation = 0;
    this.closed = false;
    this.recorder = null;
    this.micRecorder = null;
    this.micStream = null;
    this.videoStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.raf = 0;
    this.capTimer = 0;
    this.mime = null;
    this.reportedFrameRate = null;
    this.onLevel = null;
    this.onTick = null;
    this.onAutoStop = null;
    this.strokes = () => [];
    this.resize();
  }

  resize() {
    const player = document.querySelector('#canvas');
    const rect = player?.getBoundingClientRect();
    const width = Math.max(320, Math.min(960, Math.round(rect?.width || 960)));
    const height = Math.max(180, Math.min(540, Math.round(rect?.height || 540)));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.hold.width = width;
      this.hold.height = height;
    }
  }

  bindVideo() {
    const video = document.querySelector('#preview-video');
    if (!video || video === this.video) return;
    this.video?.removeEventListener('seeked', this.onSeeked);
    this.video = video;
    // A paused player can already have presented its frame before this observer exists.
    // Waiting for its next frame callback would make pencil depend on starting playback.
    this.paintedTime = video.paused && !video.seeking && video.readyState >= 2
      && video.getVideoPlaybackQuality?.().totalVideoFrames > 0 ? video.currentTime : null;
    this.onSeeked = () => { this.paintedTime = video.currentTime; };
    video.addEventListener('seeked', this.onSeeked);
  }

  sample() {
    this.bindVideo();
    const frame = Math.floor(this.editor.frame);
    const clip = clipAt(this.editor, frame);
    const video = this.video;
    const proxy = usesProxy(this.editor, clip);
    if (!proxy || !video || video.hidden) {
      const still = document.querySelector('#preview-still');
      const ready = !still || still.style.display === 'none' || (still.dataset.ready === 'true' && !!still.dataset.thumbSource && still.dataset.presentedSource === still.dataset.thumbSource);
      this.seekReady = ready;
      if (ready) {
        this.shownFrame = frame;
        this.presented = true;
      } else this.presented = false;
      return this.view(frame);
    }
    const expected = expectedTime(this.editor, frame);
    const fps = fpsOf(this.editor.doc);
    const tolerance = 0.5 / fps + 0.034;
    const seekReady = video.readyState >= 2 && !video.seeking && expected != null && Math.abs(video.currentTime - expected) <= tolerance;
    this.seekReady = seekReady;
    if (video.requestVideoFrameCallback && !this.rvfc) {
      this.rvfc = true;
      video.requestVideoFrameCallback((_now, metadata) => {
        this.rvfc = false;
        this.paintedTime = metadata?.mediaTime ?? video.currentTime;
      });
    } else if (!video.requestVideoFrameCallback && seekReady) this.paintedTime = video.currentTime;
    const painted = this.paintedTime != null && Math.abs(this.paintedTime - video.currentTime) <= tolerance;
    if (seekReady && (painted || this.editor.rate !== 0)) {
      this.shownFrame = frame;
      this.presented = true;
    } else if (!seekReady) this.presented = false;
    return this.view(frame);
  }

  view(targetFrame) {
    return {
      targetFrame,
      shownFrame: this.shownFrame,
      seekReady: this.seekReady,
      presented: this.presented && this.shownFrame === targetFrame,
    };
  }

  paint(strokes) {
    this.resize();
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const view = this.sample();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (view.presented) {
      this.drawSource(ctx, width, height);
      this.holdCtx.drawImage(this.canvas, 0, 0);
    } else if (this.shownFrame != null) ctx.drawImage(this.hold, 0, 0);
    this.drawOverlay(ctx, width, height);
    strokeInk(ctx, width, height, strokes, view.presented ? view.shownFrame : this.shownFrame);
    return view;
  }

  // Source plus the text and HUD that are actually on screen. Ink is composited later
  // so a later undo cannot leave the first stroke's pixels attached to this frame.
  presentedPlate(frame) {
    const view = this.sample();
    if (!Number.isInteger(frame) || !view.presented || view.shownFrame !== frame || view.targetFrame !== frame) return null;
    this.resize();
    const plate = document.createElement('canvas');
    plate.width = this.canvas.width;
    plate.height = this.canvas.height;
    const ctx = plate.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, plate.width, plate.height);
    this.drawSource(ctx, plate.width, plate.height);
    this.drawOverlay(ctx, plate.width, plate.height);
    return plate;
  }

  drawSource(ctx, width, height) {
    const video = document.querySelector('#preview-video');
    const still = document.querySelector('#preview-still');
    const source = video && !video.hidden && video.readyState >= 2 ? video : (still && still.style.display !== 'none' ? still : null);
    if (!source) return;
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    if (!sw || !sh) return;
    const scale = Math.min(width / sw, height / sh);
    const w = sw * scale;
    const h = sh * scale;
    ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
  }

  drawOverlay(ctx, width, height) {
    const player = document.querySelector('#canvas');
    if (!player || width < 1 || height < 1) return;
    const playerRect = player.getBoundingClientRect();
    if (playerRect.width < 1 || playerRect.height < 1) return;
    const sx = width / playerRect.width;
    const sy = height / playerRect.height;
    const text = player.querySelector('#preview-text');
    if (text) {
      paintChrome(ctx, text, playerRect, sx, sy);
      const lines = [...text.querySelectorAll('.preview-line')];
      if (lines.length) lines.forEach((line) => paintTextElement(ctx, line, playerRect, sx, sy));
      else paintTextElement(ctx, text, playerRect, sx, sy);
    }
    const hud = player.querySelector('.poster-hud');
    if (!hud) return;
    for (const span of hud.querySelectorAll('span')) {
      if (!paintChrome(ctx, span, playerRect, sx, sy)) continue;
      paintTextElement(ctx, span, playerRect, sx, sy);
    }
  }

  async arm(signal) {
    const generation = ++this.generation;
    this.releaseStreams();
    const probe = captureSupported({
      mediaRecorder: typeof MediaRecorder === 'function',
      captureStream: typeof this.canvas.captureStream === 'function',
      candidates: MIME_CANDIDATES,
      supported: (type) => MediaRecorder.isTypeSupported(type),
    });
    if (!probe.ok) throw Object.assign(Error('This browser cannot record the preview'), { code: 'unsupported' });
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(Error('Microphone is unavailable'), { code: 'permission' });
    const pendingMic = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const stopLateMic = () => pendingMic.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => {});
    let stream;
    try {
      stream = await Promise.race([
        pendingMic,
        new Promise((_resolve, reject) => setTimeout(() => reject(Object.assign(Error('Microphone request timed out'), { code: 'permission' })), 8000)),
        new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(Object.assign(Error('Released before the microphone was ready'), { code: 'released' })), { once: true })),
      ]);
    } catch (error) {
      stopLateMic();
      throw error;
    }
    if (generation !== this.generation || this.closed || signal?.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      throw Object.assign(Error('Microphone permission arrived after recording was released'), { code: 'late-permission' });
    }
    this.micStream = stream;
    this.videoStream = this.canvas.captureStream(LIMITS.captureFps);
    const videoTrack = this.videoStream.getVideoTracks()[0];
    const reported = videoTrack?.getSettings?.().frameRate;
    if (!videoTrack || reported === 0) {
      this.releaseStreams();
      throw Object.assign(Error('Preview capture produced no video frames'), { code: 'unsupported' });
    }
    this.reportedFrameRate = Number.isFinite(reported) ? reported : null;
    this.mime = probe.mime;
    const mixed = new MediaStream([videoTrack, stream.getAudioTracks()[0]].filter(Boolean));
    this.recorder = new MediaRecorder(mixed, { mimeType: this.mime, videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 });
    const audioMime = AUDIO_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
    if (audioMime && stream.getAudioTracks()[0]) {
      this.micRecorder = new MediaRecorder(new MediaStream([stream.getAudioTracks()[0]]), { mimeType: audioMime, audioBitsPerSecond: 64_000 });
    }
    this.chunks = [];
    this.micChunks = [];
    this.bytes = 0;
    this.micBytes = 0;
    this.recorder.ondataavailable = (event) => this.take(event.data, 'movie');
    this.micRecorder && (this.micRecorder.ondataavailable = (event) => this.take(event.data, 'mic'));
    this.recorder.onerror = () => this.onAutoStop?.('recorder');
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
    }
    this.startedAt = performance.now();
    this.recorder.start(250);
    this.micRecorder?.start(250);
    this.capTimer = setTimeout(() => this.onAutoStop?.('duration-cap'), Math.max(0, LIMITS.maxDurationMs - 250));
    this.loop();
    return { mime: this.mime, captureFps: LIMITS.captureFps, reportedFrameRate: this.reportedFrameRate };
  }

  take(blob, kind) {
    if (!blob || !blob.size) return;
    if (kind === 'mic') {
      this.micChunks.push(blob);
      this.micBytes += blob.size;
    } else {
      this.chunks.push(blob);
      this.bytes += blob.size;
    }
    if (this.bytes > LIMITS.maxReviewBytes || this.micBytes > LIMITS.maxMicBytes) this.onAutoStop?.('size-cap');
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.closed || !this.recorder || this.recorder.state === 'inactive') return;
      const view = this.paint(this.strokes());
      if (this.analyser && this.onLevel) {
        const data = new Uint8Array(this.analyser.fftSize);
        this.analyser.getByteTimeDomainData(data);
        let energy = 0;
        for (const value of data) energy += Math.abs(value - 128);
        this.onLevel(energy / data.length / 128);
      }
      this.onTick?.({ reviewTimeMs: performance.now() - this.startedAt, bytes: this.bytes, micBytes: this.micBytes, view });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  async finish() {
    const recorder = this.recorder;
    const micRecorder = this.micRecorder;
    const durationMs = this.startedAt ? performance.now() - this.startedAt : 0;
    clearTimeout(this.capTimer);
    cancelAnimationFrame(this.raf);
    const stopped = (target) => new Promise((resolve) => {
      if (!target || target.state === 'inactive') return resolve();
      target.addEventListener('stop', () => resolve(), { once: true });
      try { target.requestData?.(); target.stop(); } catch { resolve(); }
    });
    await Promise.race([Promise.all([stopped(recorder), stopped(micRecorder)]), new Promise((resolve) => setTimeout(resolve, 2000))]);
    const movie = await blobWithDuration(new Blob(this.chunks, { type: this.mime || 'video/webm' }), durationMs);
    const micRaw = new Blob(this.micChunks, { type: this.micRecorder?.mimeType || 'audio/webm' });
    const mic = micRaw.size ? await blobWithDuration(micRaw, durationMs) : micRaw;
    this.releaseStreams();
    this.recorder = null;
    this.micRecorder = null;
    return { movie, mic, bytes: movie.size, micBytes: mic.size, durationMs, mime: movie.type };
  }

  releaseStreams() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.capTimer);
    this.videoStream?.getTracks().forEach((track) => track.stop());
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.videoStream = null;
    this.micStream = null;
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.analyser = null;
  }

  cancelPending() {
    this.generation += 1;
    this.releaseStreams();
  }

  destroy() {
    this.closed = true;
    this.generation += 1;
    try { if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); } catch { /* already stopped */ }
    try { if (this.micRecorder && this.micRecorder.state !== 'inactive') this.micRecorder.stop(); } catch { /* already stopped */ }
    this.releaseStreams();
    this.video?.removeEventListener('seeked', this.onSeeked);
  }
}

export function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function stillFromPlate(plate, strokes, frame) {
  if (!plate || plate.width < 1 || plate.height < 1 || !Number.isInteger(frame)) return null;
  const ink = (strokes || []).filter((stroke) => stroke.anchorFrame === frame);
  if ((strokes || []).some((stroke) => stroke.anchorFrame !== frame)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = plate.width;
  canvas.height = plate.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(plate, 0, 0);
  strokeInk(ctx, canvas.width, canvas.height, ink, frame);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return { type: 'image', mimeType: 'image/png', data: bytesToBase64(await blob.arrayBuffer()), anchorFrame: frame };
}

export async function annotatedFrame(capture, strokes, frame) {
  const plate = capture.presentedPlate?.(frame);
  if (!plate) return null;
  return stillFromPlate(plate, (strokes || []).filter((stroke) => stroke.anchorFrame === frame), frame);
}
