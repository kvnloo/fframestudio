import test from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryJournal, fileHash } from '../../web/src/doc/journal.js';

// A small asynchronous, transaction-aware IndexedDB double. Writes become visible
// only when their transaction completes, so an injected abort cannot partly commit.
function memoryIndexedDB({ abortReadwriteAt = 0 } = {}) {
  const values = { bases: new Map(), commands: new Map() };
  const transactions = [], puts = [], deletes = [], opens = [], upgrades = [], events = [];
  let readwriteCount = 0, upgraded = false, closeCalls = 0, resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const clone = value => structuredClone(value);
  const valueId = (store, value) => store === 'bases'
    ? value.key : JSON.stringify([value.key, value.version]);
  const keyId = (store, key) => store === 'bases' ? key : JSON.stringify(key);
  const recordKey = (store, value) => store === 'bases'
    ? value.key : [value.key, value.version];
  function compare(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
      }
      return a.length - b.length;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const inRange = (key, range) => !range ||
    (compare(key, range.lower) >= 0 && compare(key, range.upper) <= 0);

  const db = {
    createObjectStore(name, options) {
      assert.equal(Object.hasOwn(values, name), true);
      upgrades.push({ name, keyPath: clone(options.keyPath) });
      return {};
    },
    close() {
      closeCalls++;
      events.push('close');
      resolveClosed();
    },
    transaction(names, mode = 'readonly') {
      const stores = typeof names === 'string' ? [names] : [...names];
      for (const name of stores) assert.equal(Object.hasOwn(values, name), true);
      const shouldAbort = mode === 'readwrite' && ++readwriteCount === abortReadwriteAt;
      const record = { stores, mode, puts: [], deletes: [], completed: false, aborted: false };
      transactions.push(record);
      let pending = 0, completionHandle, settled = false, fault;
      const staged = [];
      const tx = {
        error: null, oncomplete: null, onabort: null, onerror: null,
        objectStore(name) {
          assert.equal(stores.includes(name), true);
          return {
            get(key) {
              return enqueue(() => clone(values[name].get(keyId(name, key))));
            },
            getAll(range) {
              return enqueue(() => [...values[name].values()]
                .filter(value => inRange(recordKey(name, value), range))
                .sort((a, b) => compare(recordKey(name, a), recordKey(name, b)))
                .map(clone));
            },
            put(value) {
              assert.equal(mode, 'readwrite');
              const saved = clone(value), call = { store: name, value: saved };
              record.puts.push(call);
              puts.push(call);
              return enqueue(() => {
                staged.push(() => values[name].set(valueId(name, saved), clone(saved)));
                return recordKey(name, saved);
              });
            },
            delete(key) {
              assert.equal(mode, 'readwrite');
              const saved = clone(key), call = { store: name, key: saved };
              record.deletes.push(call);
              deletes.push(call);
              return enqueue(() => {
                staged.push(() => {
                  if (saved && typeof saved === 'object' && 'lower' in saved) {
                    for (const [id, value] of values[name]) {
                      if (inRange(recordKey(name, value), saved)) values[name].delete(id);
                    }
                  } else {
                    values[name].delete(keyId(name, saved));
                  }
                });
              });
            },
          };
        },
      };
      function completeWhenIdle() {
        if (completionHandle !== undefined) clearImmediate(completionHandle);
        completionHandle = setImmediate(() => {
          completionHandle = undefined;
          if (settled || pending) return;
          settled = true;
          if (shouldAbort || fault) {
            tx.error = fault || Error('Injected transaction abort');
            record.aborted = true;
            events.push('abort:' + mode);
            tx.onabort?.();
          } else {
            for (const apply of staged) apply();
            record.completed = true;
            events.push('complete:' + mode);
            tx.oncomplete?.();
          }
        });
      }
      function enqueue(work) {
        if (settled) throw Error('Transaction already settled');
        pending++;
        if (completionHandle !== undefined) clearImmediate(completionHandle);
        completionHandle = undefined;
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        setImmediate(() => {
          try {
            req.result = work();
            req.onsuccess?.();
          } catch (error) {
            fault = error;
            req.error = error;
            req.onerror?.();
          } finally {
            pending--;
            if (pending === 0) completeWhenIdle();
          }
        });
        return req;
      }
      completeWhenIdle();
      return tx;
    },
  };
  const indexedDB = {
    open(name, version) {
      opens.push({ name, version });
      const req = { result: undefined, onsuccess: null, onupgradeneeded: null, onerror: null };
      setImmediate(() => {
        req.result = db;
        if (!upgraded) {
          upgraded = true;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
    seed(store, records) {
      for (const value of records) {
        const saved = clone(value);
        values[store].set(valueId(store, saved), saved);
      }
    },
    db, values, transactions, puts, deletes, opens, upgrades, events, closed,
    get closeCalls() { return closeCalls; },
  };
  return indexedDB;
}

function installFake(t, options) {
  const fake = memoryIndexedDB(options);
  const globals = {
    indexedDB: fake,
    IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) },
    requestIdleCallback: callback => setImmediate(callback),
  };
  const original = Object.entries(globals).map(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    return [name, descriptor];
  });
  t.after(() => {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return fake;
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || Error('Aborted'));
  });
}
function requestDone(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const noError = () => {};
const command = version => ({
  key: 'k', version, command: { type: 'edit-text', version },
  patches: [{ version }],
});
function append(journal, versions) {
  for (const version of versions) {
    journal.append(command(version).command, version, command(version).patches);
  }
}
const versions = entries => entries.map(entry => entry.version);
const storedVersions = fake => versions([...fake.values.commands.values()])
  .sort((a, b) => a - b);
const readwrites = fake => fake.transactions.filter(tx => tx.mode === 'readwrite');

test('fake IndexedDB upgrades asynchronously and supports transactional put/get/getAll/delete', async t => {
  const fake = installFake(t);
  const opening = indexedDB.open('fake', 1), events = [];
  opening.onupgradeneeded = () => {
    events.push('upgrade');
    opening.result.createObjectStore('bases', { keyPath: 'key' });
    opening.result.createObjectStore('commands', { keyPath: ['key', 'version'] });
  };
  const opened = new Promise(resolve => {
    opening.onsuccess = () => { events.push('success'); resolve(opening.result); };
  });
  assert.deepEqual(events, []);
  const db = await opened;
  assert.deepEqual(events, ['upgrade', 'success']);
  assert.deepEqual(fake.opens, [{ name: 'fake', version: 1 }]);
  assert.deepEqual(fake.upgrades.map(store => store.name), ['bases', 'commands']);

  const writing = db.transaction('commands', 'readwrite'), written = transactionDone(writing);
  let successes = 0;
  writing.objectStore('commands').put(command(2)).onsuccess = () => { successes++; };
  assert.equal(successes, 0, 'put must resolve asynchronously');
  await written;
  assert.equal(successes, 1);
  const reading = db.transaction('commands', 'readonly'), read = transactionDone(reading);
  const single = requestDone(reading.objectStore('commands').get(['k', 2]));
  const all = requestDone(reading.objectStore('commands').getAll({
    lower: ['k', 0], upper: ['k', Infinity],
  }));
  assert.deepEqual(await single, command(2));
  assert.deepEqual(await all, [command(2)]);
  await read;

  const deleting = db.transaction('commands', 'readwrite'), deleted = transactionDone(deleting);
  deleting.objectStore('commands').delete({ lower: ['k', 0], upper: ['k', 2] });
  await deleted;
  assert.deepEqual(storedVersions(fake), []);
  assert.equal(fake.puts.length, 1);
  assert.equal(fake.deletes.length, 1);
  assert.deepEqual(fake.events, ['complete:readwrite', 'complete:readonly', 'complete:readwrite']);
});

test('fileHash returns canonical SHA-256 for empty and abc inputs', async () => {
  assert.equal(await fileHash(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await fileHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('constructor, base and range preserve the journal identity and revision', t => {
  const fake = installFake(t);
  const onError = () => {};
  const journal = new RecoveryJournal(fake.db, 'k', 'h', 3, onError);
  assert.deepEqual(journal.pending, []);
  assert.deepEqual(journal.recovery, []);
  assert.equal(journal.persistedVersion, 3);
  assert.equal(journal.onError, onError);
  assert.deepEqual(journal.base(), {
    key: 'k', baseHash: 'h', baseRevision: 3, preparedSave: undefined,
  });
  assert.deepEqual(journal.range(5), { lower: ['k', 0], upper: ['k', 5] });
});

test('flush persists six commands in exactly two four-entry/remaining batches', async t => {
  const fake = installFake(t);
  const journal = new RecoveryJournal(fake.db, 'k', 'h', 0, noError);
  append(journal, [1, 2, 3, 4, 5, 6]);
  await journal.flush();
  assert.equal(readwrites(fake).length, 2);
  assert.deepEqual(readwrites(fake).map(tx => tx.puts.map(call =>
    call.store === 'bases' ? 'base' : call.value.version)), [
    ['base', 1, 2, 3, 4], ['base', 5, 6],
  ]);
  assert.deepEqual(storedVersions(fake), [1, 2, 3, 4, 5, 6]);
  assert.equal(journal.persistedVersion, 6);
  assert.deepEqual(journal.pending, []);
});

test('empty flush opens no IndexedDB transaction', async t => {
  const fake = installFake(t);
  const journal = new RecoveryJournal(fake.db, 'k', 'h', 3, noError);
  await journal.flush();
  assert.equal(fake.transactions.length, 0);
  assert.deepEqual(journal.pending, []);
  assert.equal(journal.persistedVersion, 3);
});

test('aborted second flush batch rejects and restores only versions 5 and 6', async t => {
  const fake = installFake(t, { abortReadwriteAt: 2 });
  const journal = new RecoveryJournal(fake.db, 'k', 'h', 0, noError);
  append(journal, [1, 2, 3, 4, 5, 6]);
  await assert.rejects(journal.flush(), /Injected transaction abort/);
  assert.deepEqual(readwrites(fake).map(tx => [tx.completed, tx.aborted]),
    [[true, false], [false, true]]);
  assert.deepEqual(versions(journal.pending), [5, 6]);
  assert.equal(journal.persistedVersion, 4);
  assert.deepEqual(storedVersions(fake), [1, 2, 3, 4]);
});

test('checkpoint prunes through revision 3, then flushes pending versions 4 and 5', async t => {
  const fake = installFake(t);
  fake.seed('commands', [1, 2, 3].map(command));
  const journal = new RecoveryJournal(fake.db, 'k', 'old-hash', 0, noError);
  journal.preparedSave = { hash: 'old-prepared', version: 1 };
  journal.recovery = [command(2)];
  append(journal, [2, 3, 4, 5]);
  const raw = '{"revision":3}';
  await journal.checkpoint(raw, 3);
  assert.deepEqual(versions(journal.pending), []);
  assert.deepEqual(readwrites(fake).map(tx => tx.puts
    .filter(call => call.store === 'commands')
    .map(call => call.value.version)), [[], [4, 5]]);
  assert.deepEqual(storedVersions(fake), [4, 5]);
  assert.deepEqual(fake.deletes.map(call => ({ store: call.store, key: call.key })), [{
    store: 'commands', key: { lower: ['k', 0], upper: ['k', 3] },
  }]);
  const lastBase = fake.puts.filter(call => call.store === 'bases').at(-1).value;
  assert.equal(lastBase.baseHash, await fileHash(raw));
  assert.equal(lastBase.baseRevision, 3);
  assert.equal(lastBase.preparedSave, undefined);
  assert.deepEqual(journal.recovery, []);
  assert.equal(journal.persistedVersion, 5);
});

test('discard checkpoint drops all pending commands and deletes through Infinity', async t => {
  const fake = installFake(t);
  fake.seed('commands', [1, 2, 3].map(command));
  const journal = new RecoveryJournal(fake.db, 'k', 'old-hash', 0, noError);
  append(journal, [2, 3, 4, 5]);
  await journal.checkpoint('discarded', 3, true);
  assert.deepEqual(journal.pending, []);
  assert.deepEqual(storedVersions(fake), []);
  assert.deepEqual(fake.deletes.map(call => call.key), [
    { lower: ['k', 0], upper: ['k', Infinity] },
  ]);
  assert.equal(readwrites(fake).length, 1);
  assert.equal(fake.puts.filter(call => call.store === 'commands').length, 0);
  assert.equal(journal.persistedVersion, 3);
});

test('prepareSave records the new disk hash and version in the final bases put', async t => {
  const fake = installFake(t);
  const journal = new RecoveryJournal(fake.db, 'k', 'h', 3, noError);
  const raw = '{"revision":7}';
  await journal.prepareSave(raw, 7);
  const expected = { hash: await fileHash(raw), version: 7 };
  assert.deepEqual(journal.preparedSave, expected);
  assert.deepEqual(fake.puts.filter(call => call.store === 'bases').at(-1).value, {
    key: 'k', baseHash: 'h', baseRevision: 3, preparedSave: expected,
  });
  assert.equal(readwrites(fake).length, 1);
});

test('open with empty stores has no recovery and starts at document revision', async t => {
  const fake = installFake(t);
  const journal = await RecoveryJournal.open('k', 'disk', { revision: 3 }, noError);
  assert.deepEqual(journal.recovery, []);
  assert.equal(journal.persistedVersion, 3);
  assert.deepEqual(fake.opens, [{ name: 'fframestudio.recovery', version: 1 }]);
  assert.deepEqual(fake.upgrades.map(value => value.name), ['bases', 'commands']);
  assert.equal(fake.transactions.filter(tx => tx.mode === 'readonly').length, 1);
  journal.close();
  await fake.closed;
});

test('open replays only commands newer than the matching disk revision', async t => {
  const fake = installFake(t);
  const raw = 'matching file';
  fake.seed('bases', [{ key: 'k', baseHash: await fileHash(raw), baseRevision: 3 }]);
  fake.seed('commands', [1, 2, 3, 4, 5].map(command));
  const journal = await RecoveryJournal.open('k', raw, { revision: 3 }, noError);
  assert.deepEqual(versions(journal.recovery), [4, 5]);
  assert.equal(journal.persistedVersion, 5);
  assert.equal(readwrites(fake).length, 0);
  journal.close();
  await fake.closed;
});

test('open rejects a mismatched disk with newer commands and closes its database', async t => {
  const fake = installFake(t);
  fake.seed('bases', [{ key: 'k', baseHash: await fileHash('other file'), baseRevision: 3 }]);
  fake.seed('commands', [1, 2, 3, 4, 5].map(command));
  await assert.rejects(
    RecoveryJournal.open('k', 'current file', { revision: 3 }, noError),
    /different disk version/,
  );
  assert.equal(fake.closeCalls, 1);
  assert.deepEqual(storedVersions(fake), [1, 2, 3, 4, 5]);
});

test('open reconciles preparedSave matching disk hash and checkpoints old commands', async t => {
  const fake = installFake(t);
  const raw = 'saved file', hash = await fileHash(raw);
  fake.seed('bases', [{
    key: 'k', baseHash: await fileHash('older file'), baseRevision: 1,
    preparedSave: { hash, version: 3 },
  }]);
  fake.seed('commands', [1, 2, 3, 4, 5].map(command));
  const journal = await RecoveryJournal.open('k', raw, { revision: 3 }, noError);
  assert.deepEqual(versions(journal.recovery), [4, 5]);
  assert.equal(journal.persistedVersion, 5);
  assert.deepEqual(storedVersions(fake), [4, 5]);
  const lastBase = fake.puts.filter(call => call.store === 'bases').at(-1).value;
  assert.equal(lastBase.baseRevision, 3);
  assert.equal(lastBase.baseHash, hash);
  assert.equal(lastBase.preparedSave, undefined);
  journal.close();
  await fake.closed;
});

test('close flushes pending commands before closing the database exactly once', async t => {
  const fake = installFake(t);
  const journal = new RecoveryJournal(fake.db, 'k', 'h', 0, noError);
  append(journal, [1, 2]);
  journal.close();
  await fake.closed;
  assert.deepEqual(storedVersions(fake), [1, 2]);
  assert.equal(journal.persistedVersion, 2);
  assert.deepEqual(journal.pending, []);
  assert.equal(fake.closeCalls, 1);
  assert.deepEqual(fake.events.slice(-2), ['complete:readwrite', 'close']);
});
