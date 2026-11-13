// Review bytes live in their own IndexedDB database. Bridge files are optional and read back
// through /lib. This module never writes project.json.

const DB_NAME = 'fframestudio-feedback';
const STORE = 'reviews';
const MAX_PER_PROJECT = 8;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('byProject', 'projectId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function requestResult(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || Error('IndexedDB request failed'));
  });
}

// Request success is not durability. Callers must wait until the transaction commits
// before closing the database, and a failed write must roll back every delete with it.
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error || Error('IndexedDB transaction failed'));
  });
}

async function readRows(db, projectId) {
  const tx = db.transaction(STORE, 'readonly');
  const done = transactionDone(tx);
  try {
    const rows = await requestResult(tx.objectStore(STORE).index('byProject').getAll(projectId));
    await done;
    return rows || [];
  } catch (error) {
    await done.catch(() => {});
    throw error;
  }
}

export async function saveLocalReview(record) {
  const recorded = record?.movie instanceof Blob && record.movie.size > 0;
  const annotated = record?.kind === 'annotation' && record.phase === 'idle' && record.movie == null && !record.mic
    && record.review?.strokes?.length > 0 && record.frames?.length > 0 && record.plates?.length > 0
    && !record.review?.artifacts?.movie && !record.review?.artifacts?.movieBytes
    && record.review.strokes.every(stroke => Number.isInteger(stroke.anchorFrame)
      && record.frames.some(frame => frame.anchorFrame === stroke.anchorFrame && typeof frame.data === 'string' && frame.data)
      && record.plates.some(plate => plate.anchorFrame === stroke.anchorFrame && plate.blob instanceof Blob && plate.blob.size > 0));
  const typed = record?.phase === 'idle' && record.movie == null
    && typeof record.review?.direction === 'string' && record.review.direction.trim()
    && !record.mic && !record.frames?.length && !record.plates?.length
    && !record.review?.strokes?.length && !record.review?.transport?.length
    && !record.review?.artifacts?.movie && !record.review?.artifacts?.movieBytes;
  if (!record || typeof record.id !== 'string' || (!recorded && !typed && !annotated)
    || record.review?.id !== record.id || record.review?.projectId !== record.projectId
    || record.review?.videoId !== record.videoId) throw Error('Invalid review record');
  const db = await openDb();
  try {
    const existing = await readRows(db, record.projectId);
    const stale = existing.filter((item) => item && item.id !== record.id).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
    const drops = [];
    while (stale.length >= MAX_PER_PROJECT) drops.push(stale.shift().id);
    const tx = db.transaction(STORE, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    // Put the full record first in the same transaction as any prune. An abort keeps every prior byte.
    // A delayed text-only edit must never replace a completed recording with no bytes.
    const prior = store.get(record.id);
    prior.onsuccess = () => {
      if (!recorded && prior.result?.movie?.size) { tx.abort(); return; }
      store.put(record);
      for (const id of drops) store.delete(id);
    };
    await done;
  } finally {
    db.close();
  }
}

export async function loadLocalReview(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const done = transactionDone(tx);
    try {
      const row = await requestResult(tx.objectStore(STORE).get(id));
      await done;
      return row;
    } catch (error) {
      await done.catch(() => {});
      throw error;
    }
  } finally { db.close(); }
}

export async function latestLocalReview(projectId, videoId) {
  const db = await openDb();
  try {
    const rows = await readRows(db, projectId);
    return rows.filter((row) => row && row.videoId === videoId).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] || null;
  } finally { db.close(); }
}

export async function deleteLocalReview(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(STORE).delete(id);
    await done;
  } finally { db.close(); }
}

async function sha256(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function putFile(request, path, body, type) {
  const response = await request('/fs?path=' + encodeURIComponent(path), {
    method: 'PUT',
    headers: { 'Content-Type': type },
    body,
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error || ''; } catch { detail = ''; }
    throw Error(detail || 'Review save failed: ' + response.status);
  }
}

export async function persistToBridge(request, projectId, reviewId, movie, mic, sidecarText) {
  const base = `projects/${projectId}/reviews/${reviewId}`;
  await putFile(request, base + '.webm', movie, 'application/octet-stream');
  if (mic && mic.size) await putFile(request, base + '.mic.webm', mic, 'application/octet-stream');
  const paths = {
    jsonPath: base + '.json',
    moviePath: `reviews/${reviewId}.webm`,
    micPath: mic && mic.size ? `reviews/${reviewId}.mic.webm` : null,
    movieUrl: `/lib/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewId + '.webm')}`,
  };
  await putFile(request, paths.jsonPath, sidecarText, 'application/json');
  const json = await request('/fs?path=' + encodeURIComponent(base + '.json'));
  if (!json.ok) throw Error('Review sidecar readback failed');
  const read = await json.json();
  if (read.content !== sidecarText) throw Error('Review sidecar readback mismatched');
  const back = await request(paths.movieUrl);
  if (!back.ok) throw Error('Review movie readback failed');
  const bytes = await back.blob();
  if (bytes.size !== movie.size || await sha256(bytes) !== await sha256(movie)) throw Error('Review movie readback mismatched');
  return paths;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
