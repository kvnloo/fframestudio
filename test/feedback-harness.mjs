#!/usr/bin/env node
// Focused recorded-review harness. It uses a private HOME, --no-config, and a free port.
// Set TMPDIR to a roomy tmpfs before running. This file does not start a browser by itself
// until verifyFeedback does.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyFeedback } from './feedback-journey.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
const keep = argv.includes('--keep');
const out = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(root, 'verify-out', 'feedback-' + new Date().toISOString().replace(/[:.]/g, '-')));
const configPath = path.join(os.homedir(), '.config', 'fframestudio', 'bridge.json');
const snap = (file) => {
  if (!fs.existsSync(file)) return { exists: false };
  const stat = fs.statSync(file);
  return { exists: true, mtimeMs: stat.mtimeMs, bytes: fs.readFileSync(file) };
};
const before = snap(configPath);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-feedback-home-'));
const env = { ...process.env, HOME: home, FFS_SOURCES: path.join(root, 'projects/sources.example.json') };
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
  if (result.status) throw Error(`${command} failed\n${(result.stderr || '').slice(-800)}`);
};
const assert = (condition, message) => { if (!condition) throw Error(message); };

try {
  run('python3', ['tools/make_demo.py']);
  run('python3', ['tools/import_projects.py']);
  const detail = await verifyFeedback({ root, home, out, assert, source: path.join(home, 'fframestudio/demo-src/demo.mp4') });
  const after = snap(configPath);
  assert(before.exists === after.exists, 'shared bridge config existence changed');
  if (before.exists) {
    assert(before.mtimeMs === after.mtimeMs, 'shared bridge config mtime changed');
    assert(Buffer.compare(before.bytes, after.bytes) === 0, 'shared bridge config bytes changed');
  }
  fs.writeFileSync(path.join(out, 'feedback-report.json'), JSON.stringify({ ok: true, configUntouched: true, configExisted: before.exists, ...detail }, null, 2));
  console.log(JSON.stringify({ ok: true, out, configUntouched: true, ...detail }));
} finally {
  if (!keep) fs.rmSync(home, { recursive: true, force: true });
}
