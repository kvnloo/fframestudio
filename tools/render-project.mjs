#!/usr/bin/env node
// Render a library project to mp4, the same code path as the studio's "Export video" button.
// Usage: node tools/render-project.mjs --project ID [--root ~/fframestudio] [--video VIDEO_ID] [--out FILE]
import os from 'node:os';
import path from 'node:path';
import { renderProject } from '../bridge/render.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const projectId = opt('--project');
if (!projectId) { console.error('usage: render-project.mjs --project ID [--root DIR] [--video ID] [--out FILE]'); process.exit(2); }
const root = path.resolve(opt('--root', path.join(os.homedir(), 'fframestudio')));
let last = -1;
const r = await renderProject({ root, projectId, videoId: opt('--video'), out: opt('--out'), onProgress: ({ frame, frames }) => {
  const pct = Math.floor((100 * frame) / frames / 10) * 10; if (pct !== last) { last = pct; process.stderr.write(`render ${pct}%\n`); } } });
console.log(JSON.stringify({ file: r.file, sidecar: r.sidecar, frames: r.frames, seconds: r.seconds, clips: r.clips.length }));
