const video = document.querySelector('#film');
const status = document.querySelector('#status');
const sound = document.querySelector('#sound');
const readout = document.querySelector('#fps');
const debug = new URLSearchParams(location.search).get('debug') === '1';
// Manifest order is the default. Refresh-adaptive selection is deliberately not implemented.
try {
  const response = await fetch('/launch/variants.json');
  if (!response.ok) throw Error('Media manifest unavailable');
  const manifest = await response.json();
  for (const variant of manifest.variants) {
    const source = document.createElement('source');
    source.src = variant.url;
    source.type = `video/mp4; codecs="${variant.codec}"`;
    source.dataset.fps = String(variant.fps);
    source.dataset.bytes = String(variant.bytes);
    source.addEventListener('error', () => { status.textContent = 'Trying the next compatible version…'; });
    video.append(source);
  }
  video.load();
} catch {
  status.textContent = 'Film unavailable. Open the film page to try again.';
}
sound.addEventListener('click', () => { video.muted = !video.muted; });
video.addEventListener('volumechange', () => {
  sound.textContent = video.muted ? 'Unmute' : 'Mute';
  sound.setAttribute('aria-label', video.muted ? 'Unmute film' : 'Mute film');
});
const updateStatus = () => {
  const state = video.ended ? 'Finished · replay any time' : video.paused ? 'Tap play to watch' : 'Playing';
  status.textContent = state + ' · sound ' + (video.muted ? 'off' : 'on');
};
for (const event of ['loadedmetadata', 'playing', 'pause', 'volumechange']) video.addEventListener(event, updateStatus);
video.addEventListener('error', () => { status.textContent = 'No compatible video decoder. Open the film page to download the MP4.'; });
if (debug) {
  readout.hidden = false;
  readout.textContent = 'Waiting for playback…';
  if (!('requestVideoFrameCallback' in video)) {
    readout.textContent = 'Frame callbacks unavailable';
  } else {
    let start, callbacks = 0;
    const reset = () => { start = undefined; callbacks = 0; };
    for (const event of ['playing', 'seeking', 'pause']) video.addEventListener(event, reset);
    const frame = (now, metadata) => {
      if (!video.paused && !video.seeking) {
        if (!start) start = {now, mediaTime: metadata.mediaTime, presented: metadata.presentedFrames};
        callbacks++;
        const elapsed = (now - start.now) / 1000;
        if (elapsed >= 1) {
          // Count callbacks, NOT mediaTime steps: a 120 fps file on 60 Hz must not report 120.
          const fps = (callbacks - 1) / elapsed;
          readout.dataset.fps = fps.toFixed(2);
          readout.dataset.presentedDelta = String(metadata.presentedFrames - start.presented);
          readout.textContent = `${fps.toFixed(1)} callbacks/s · ${video.videoWidth}×${video.videoHeight} · not a panel-Hz measurement`;
          reset();
        }
      }
      video.requestVideoFrameCallback(frame);
    };
    video.requestVideoFrameCallback(frame);
  }
}
