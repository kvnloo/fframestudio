// HTML video seeking is not exposed in workers. Keep one paused, detached decoder;
// the thumbnail worker owns resizing/caching. Never seek the playing preview.
export class PosterDecoder {
  constructor(editor) { this.e = editor; this.queue = []; }
  request(id, canvas) {
    this.queue = this.queue.filter(item => {
      if (item.canvas.isConnected) return true;
      this.e.thumbTargets.delete(item.id); return false;
    });
    this.queue.push({ id, canvas });
    if (!this.running) this.drain();
  }
  async drain() {
    this.running = true;
    const video = this.video ||= document.createElement('video');
    video.muted = true; video.preload = 'auto';
    while (this.queue.length && !this.e.dead) {
      const { id, canvas } = this.queue.shift();
      if (!canvas.isConnected) { this.e.thumbTargets.delete(id); continue; }
      try {
        const wait = (event, act) => new Promise((resolve, reject) => {
          const clean = () => { clearTimeout(timer); video.removeEventListener(event, ok); video.removeEventListener('error', fail); };
          const ok = () => { clean(); resolve(); }, fail = () => { clean(); reject(Error('Poster decode unavailable')); };
          const timer = setTimeout(fail, 5000);
          video.addEventListener(event, ok, { once:true }); video.addEventListener('error', fail, { once:true }); act();
        });
        if (video.getAttribute('src') !== canvas.dataset.video) {
          await wait('loadeddata', () => { video.src = canvas.dataset.video; video.load(); });
        }
        const time = Math.max(0, Math.min(video.duration - .05, +canvas.dataset.midpoint));
        if (Math.abs(video.currentTime - time) > .001) await wait('seeked', () => { video.currentTime = time; });
        if (this.e.dead) break;
        const bitmap = await createImageBitmap(video);
        this.e.thumbs.postMessage({ id, bitmap, key:canvas.dataset.video + ':' + canvas.dataset.midpoint }, [bitmap]);
      } catch { this.e.thumbTargets.delete(id); }
    }
    this.running = false;
  }
  destroy() { this.queue.length = 0; this.video?.pause(); this.video?.removeAttribute('src'); this.video?.load(); }
}
