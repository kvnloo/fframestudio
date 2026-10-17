import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function projectID(id) {
  if (typeof id !== 'string' || !/^[\w-][\w.-]*$/.test(id) || id === '..') throw new Error('Invalid project id');
  return id;
}

export function validateBridge(info) {
  let url;
  try { url = new URL(info.url); } catch { throw new Error('Invalid bridge URL'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Bridge must use an HTTP loopback origin (127.0.0.1)');
  if (!Number.isInteger(info.pid) || info.pid < 1 || typeof info.root !== 'string' || !path.isAbsolute(info.root) || typeof info.token !== 'string' || !/^[\w-]+$/.test(info.token))
    throw new Error('Invalid bridge discovery data');
  return info;
}

export async function readBridge(home = os.homedir()) {
  let info;
  try { info = JSON.parse(await fs.readFile(process.env.FFS_BRIDGE_FILE || path.join(home, '.config/fframestudio/bridge.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Cannot read bridge discovery file'); }
  return validateBridge(info);
}

export async function requestJSON(info, route) {
  validateBridge(info);
  if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Invalid bridge route');
  let response;
  try { response = await fetch(info.url + route, { headers: { Authorization: `Bearer ${info.token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) }); }
  catch { throw new Error('Bridge request failed; check the local bridge'); }
  if (!response.ok) throw new Error(`Bridge request failed (HTTP ${response.status})`);
  try { return await response.json(); } catch { throw new Error('Bridge returned invalid JSON'); }
}

export function editorURL(info, id) {
  validateBridge(info);
  const url = new URL('/open', info.url);
  url.searchParams.set('token', info.token);
  url.searchParams.set('to', id ? `#/p/${projectID(id)}` : '');
  return url.href;
}
