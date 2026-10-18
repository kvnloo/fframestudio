import { parseProfile, validateProfile } from './profile.js';

export function mockAdapter(fixture, state = 'ready') {
  if (!['ready', 'disconnected', 'offline', 'unauthorized'].includes(state)) throw Error('Invalid adapter state');
  const profile = state === 'ready' ? structuredClone(validateProfile(fixture)) : null;
  return { async getProfile() { return profile ? { state, profile: structuredClone(profile) } : { state }; } };
}

// Storage injection keeps the adapter testable without a DOM or runtime dependency.
export function fileAdapter(storage = indexedDBStorage()) {
  let generation = 0, writes = Promise.resolve();
  return {
    async getProfile() {
      await writes;
      try { const text = await storage.get(); return text ? { state: 'ready', profile: parseProfile(text) } : { state: 'disconnected' }; }
      catch { return { state: 'offline' }; }
    },
    async importJSON(text) {
      const profile = parseProfile(text), epoch = ++generation;
      writes = writes.catch(() => {}).then(() => storage.set(JSON.stringify(profile)));
      await writes;
      return epoch === generation ? { state: 'ready', profile } : { state: 'disconnected' };
    },
    async deleteProfile() {
      ++generation;
      writes = writes.catch(() => {}).then(() => storage.delete());
      await writes;
      return { state: 'disconnected' };
    },
  };
}
export function indexedDBStorage() {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('fframestudio.taste', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('aggregate');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  const transact = async (mode, action) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('aggregate', mode), req = action(tx.objectStore('aggregate'));
        let result;
        req.onsuccess = () => { result = req.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(tx.error || Error('Taste storage failed'));
      });
    } finally { db.close(); }
  };
  return { get: () => transact('readonly', s => s.get('profile')), set: text => transact('readwrite', s => s.put(text, 'profile')), delete: () => transact('readwrite', s => s.delete('profile')) };
}

// Only talks to the already authenticated bridge. No URL or token input in the UI.
export function bridgeAdapter(request) {
  return { async getProfile() {
    try {
      const r = await request('/taste/profile');
      if (r.status === 401 || r.status === 403) return { state: 'unauthorized' };
      if (!r.ok) return { state: r.status === 404 ? 'disconnected' : 'offline' };
      const result = await r.json();
      if (result.state === 'ready') return { state: 'ready', profile: validateProfile(result.profile) };
      return { state: ['offline', 'unauthorized', 'disconnected', 'invalid'].includes(result.state) ? result.state : 'invalid' };
    } catch { return { state: 'offline' }; }
  } };
}
