export async function fileHash(raw) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const completed = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onabort = tx.onerror = () => reject(tx.error || Error('Recovery transaction aborted'));
});

export class RecoveryJournal {
  static async open(key, raw, document, onError) {
    const opening = indexedDB.open('fframestudio.recovery', 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore('bases', { keyPath: 'key' });
      opening.result.createObjectStore('commands', { keyPath: ['key', 'version'] });
    };
    const db = await request(opening);
    db.onversionchange = () => db.close();
    const journal = new RecoveryJournal(db, key, await fileHash(raw), document.revision, onError);
    const tx = db.transaction(['bases', 'commands'], 'readonly'), done = completed(tx);
    const [base, entries] = await Promise.all([
      request(tx.objectStore('bases').get(key)),
      request(tx.objectStore('commands').getAll(journal.range())),
    ]);
    await done;
    if (base && entries.length) {
      if (base.baseHash === journal.baseHash && base.baseRevision === document.revision) {
        journal.recovery = entries.filter((entry) => entry.version > document.revision);
        journal.persistedVersion = entries.at(-1).version;
      } else if (base.preparedSave?.hash === journal.baseHash &&
                 base.preparedSave.version === document.revision) {
        // The file reached disk but this page died before acknowledging Save.
        await journal.checkpoint(raw, document.revision);
        journal.recovery = entries.filter((entry) => entry.version > document.revision);
        journal.persistedVersion = entries.at(-1).version;
      } else if (entries.at(-1).version > document.revision) {
        db.close();
        throw Error('Unsaved recovery belongs to a different disk version. Saved file kept; journal retained.');
      }
    }
    return journal;
  }
  constructor(db, key, baseHash, baseRevision, onError) {
    Object.assign(this, { db, key, baseHash, baseRevision, onError,
      pending: [], recovery: [], persistedVersion: baseRevision, writing: Promise.resolve() });
  }
  range(through = Infinity) {
    return IDBKeyRange.bound([this.key, 0], [this.key, through]);
  }
  append(command, version, patches) {
    if (!this.pending.length) this.firstPending = performance.now();
    this.pending.push({ key: this.key, command, version, patches });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(this.onError),
      Math.max(0, Math.min(250, 1000 - (performance.now() - this.firstPending))));
  }
  enqueue(operation) {
    const result = this.writing.then(operation);
    this.writing = result.catch(() => {});
    return result;
  }
  flush() {
    clearTimeout(this.timer);
    this.firstPending = null;
    const entries = this.pending.splice(0);
    if (!entries.length) return this.writing;
    const base = this.base();
    return this.enqueue(async () => {
      // A burst must not become one large structured clone on the UI thread.
      // Each durable prefix is replayable if the page dies between batches.
      for (let offset = 0; offset < entries.length; offset += 4) {
        await new Promise((resolve) => requestIdleCallback(resolve, { timeout: 1000 }));
        const batch = entries.slice(offset, offset + 4), start = performance.now();
        try {
          const tx = this.db.transaction(['bases', 'commands'], 'readwrite'), done = completed(tx);
          tx.objectStore('bases').put(base);
          for (const entry of batch) tx.objectStore('commands').put(entry);
          const cpuMs = performance.now() - start;
          await done;
          this.persistedVersion = batch.at(-1).version;
          performance.measure('recovery-write', { start, end: performance.now(), detail: { cpuMs, entries: batch.length } });
        } catch (error) {
          this.pending.unshift(...entries.slice(offset));
          throw error;
        }
      }
    });
  }
  base() {
    return { key: this.key, baseHash: this.baseHash, baseRevision: this.baseRevision,
      preparedSave: this.preparedSave };
  }
  async prepareSave(raw, version) {
    this.preparedSave = { hash: await fileHash(raw), version };
    await this.flush();
    const base = this.base();
    await this.enqueue(async () => {
      const tx = this.db.transaction('bases', 'readwrite'), done = completed(tx);
      tx.objectStore('bases').put(base);
      await done;
    });
  }
  async checkpoint(raw, version, discard = false) {
    const baseHash = await fileHash(raw);
    this.baseHash = baseHash;
    this.baseRevision = version;
    this.preparedSave = undefined;
    this.pending = discard ? [] : this.pending.filter((entry) => entry.version > version);
    const base = this.base();
    // Prior writes finish first; edits committed during a Save stay in the journal.
    await this.enqueue(async () => {
      const tx = this.db.transaction(['bases', 'commands'], 'readwrite'), done = completed(tx);
      tx.objectStore('commands').delete(this.range(discard ? Infinity : version));
      tx.objectStore('bases').put(base);
      await done;
      this.recovery = [];
      this.persistedVersion = Math.max(this.persistedVersion, version);
    });
    await this.flush();
  }
  close() {
    this.flush().catch(this.onError).finally(() => this.db.close());
  }
}
