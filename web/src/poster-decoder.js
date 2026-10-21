// HTML video seeking is not exposed in workers. Keep one paused, detached decoder;
// the thumbnail worker owns resizing/caching. Never seek the playing preview.
export class PosterDecoder {
  constructor(editor) { this.e = editor; this.queue = []; this.captures = 0; }
  request(id, canvas) {
    this.queue = this.queue.filter(item => {
      if (item.capture || item.canvas.isConnected) return true;
      this.e.thumbTargets.delete(item.id); return false;
    });
    this.queue.push({ id, canvas });
    if (!this.running) this.drain();
  }
  // Full-size still for image-to-video: same detached decoder (serialized with
  // posters), then the thumbnail worker crops/encodes it to PNG off the UI thread.
  capture(url, time, width, height) {
    return new Promise((resolve, reject) => {
      this.queue.push({ capture: { url, time, width, height, resolve, reject } });
      if (!this.running) this.drain();
    });
  }
  async drain() {
    this.running = true;
    const video = this.video ||= document.createElement('video');
    video.muted = true; video.preload = 'auto';
    while (this.queue.length && !this.e.dead) {
      const { id, canvas, capture } = this.queue.shift();
      if (!capture && !canvas.isConnected) { this.e.thumbTargets.delete(id); continue; }
      try {
        const wait = (event, act) => new Promise((resolve, reject) => {
          const clean = () => { clearTimeout(timer); video.removeEventListener(event, ok); video.removeEventListener('error', fail); };
          const ok = () => { clean(); resolve(); }, fail = () => { clean(); reject(Error('Poster decode unavailable')); };
          const timer = setTimeout(fail, 5000);
          video.addEventListener(event, ok, { once:true }); video.addEventListener('error', fail, { once:true }); act();
        });
        const src = capture ? capture.url : canvas.dataset.video;
        if (video.getAttribute('src') !== src) {
          await wait('loadeddata', () => { video.src = src; video.load(); });
        }
        const time = Math.max(0, Math.min(video.duration - .05, capture ? capture.time : +canvas.dataset.midpoint));
        if (Math.abs(video.currentTime - time) > .001) await wait('seeked', () => { video.currentTime = time; });
        if (this.e.dead) break;
        const bitmap = await createImageBitmap(video);
        if (capture) capture.resolve(await this.encode(bitmap, capture));
        else this.e.thumbs.postMessage({ id, bitmap, key:canvas.dataset.video + ':' + canvas.dataset.midpoint }, [bitmap]);
      } catch {
        if (capture) capture.reject(Error('Cannot decode the playhead frame for a reference.'));
        else this.e.thumbTargets.delete(id);
      }
    }
    for (const item of this.queue.filter(item => item.capture)) item.capture.reject(Error('Editor closed'));
    if (this.e.dead) this.queue.length = 0;
    this.running = false;
  }
  encode(bitmap, { width, height }) {
    const id = 'capture:' + ++this.captures, worker = this.e.thumbs;
    return new Promise((resolve, reject) => {
      const done = ({ data }) => {
        if (data?.id !== id) return;
        worker.removeEventListener('message', done);
        if (data.blob) resolve(data.blob); else reject(Error('Reference encode failed'));
      };
      worker.addEventListener('message', done);
      worker.postMessage({ id, bitmap, capture: { width, height } }, [bitmap]);
    });
  }
  destroy() {
    for (const item of this.queue.splice(0)) item.capture?.reject(Error('Editor closed'));
    this.video?.pause(); this.video?.removeAttribute('src'); this.video?.load();
  }
}
