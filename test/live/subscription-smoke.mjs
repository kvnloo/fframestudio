// Explicit opt-in provider smoke: silent synthetic WebRTC, never a fixture success.
// Run on MBP with FFS_LIVE_HELPER_COMMAND configured; no ACP/model task is sent.
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { liveAPI } from '../../bridge/live.mjs';

if (!process.env.FFS_LIVE_HELPER_COMMAND) throw Error('FFS_LIVE_HELPER_COMMAND required');
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const live = liveAPI({ send });
const server = http.createServer(async (req, res) => {
  if (req.url === '/') { res.end('<!doctype html><title>Subscription live backend smoke</title>'); return; }
  await live(req, res, new URL(req.url, 'http://localhost'));
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const pc = new RTCPeerConnection();
    const audio = new AudioContext();
    const silent = audio.createMediaStreamDestination();
    const track = silent.stream.getAudioTracks()[0]; pc.addTrack(track, silent.stream);
    pc.createDataChannel('oai-events');
    let call;
    const request = async (path, method, body) => {
      const response = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(call ? { 'x-ffs-live-token': call.callToken } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json(); if (!response.ok) throw Error(`${response.status}: ${data.error}`); return data;
    };
    try {
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      call = await request('/live/calls', 'POST', { sdp: offer.sdp });
      await pc.setRemoteDescription({ type: 'answer', sdp: call.sdp });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('WebRTC connection timeout')), 20000);
        const check = () => { if (pc.connectionState === 'connected') { clearTimeout(timer); resolve(); } else if (pc.connectionState === 'failed') { clearTimeout(timer); reject(Error('WebRTC connection failed')); } };
        pc.addEventListener('connectionstatechange', check); check();
      });
      const appended = await request(`/live/calls/${call.callId}/context`, 'POST', { channel: 'commentary', text: 'Backend qualification only. Remain silent; no action is requested.' });
      const events = await request(`/live/calls/${call.callId}/events?after=0`, 'GET');
      return { model: call.model, webrtcConnected: true, contextAppended: appended.ok, sidebandClosed: events.closed };
    } finally {
      if (call) await request(`/live/calls/${call.callId}`, 'DELETE');
      pc.close(); track.stop(); await audio.close();
    }
  });
  assert.equal(result.model, 'gpt-live-1-codex'); assert.equal(result.webrtcConnected, true); assert.equal(result.contextAppended, true); assert.equal(result.sidebandClosed, false);
  console.log(JSON.stringify(result));
} finally {
  live.close(); if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
}
