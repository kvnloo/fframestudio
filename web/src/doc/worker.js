import { fromV0 } from './project.js';
import { CommandStore, diff, proposalCommand, recoveryCommand } from './commands.js';

// Background operations take explicit snapshots. The main-thread CommandStore is
// the only live document; worker results never replace it after a command.
self.onmessage = ({ data: { id, type, value } }) => {
  try {
    let result;
    if (type === 'open') {
      result = { doc: fromV0(typeof value === 'string' ? JSON.parse(value) : value) };
    } else if (type === 'compare') result = diff(value[0], value[1]);
    else if (type === 'serialize') result = JSON.stringify(value, null, 1);
    else if (type === 'replay') {
      const store = new CommandStore(value.document);
      for (const entry of value.entries) {
        store.commit(recoveryCommand(entry));
        if (store.doc.revision !== entry.version) throw Error('Recovery version mismatch');
      }
      result = { doc: store.doc, undo: store.past.length, redo: store.future.length };
    } else if (type === 'preview' || type === 'proposal') {
      const store = new CommandStore(value.document);
      const command = type === 'proposal' ? proposalCommand(value.command, store.doc) : value.command;
      const p = store.preview(command);
      result = { scope: p.scope, diff: p.diff };
    } else throw Error(`Unknown background operation: ${type}`);
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e.message });
  }
};
