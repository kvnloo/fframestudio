import { fromV0 } from './project.js';
import { CommandStore, diff, proposalCommand } from './commands.js';
let store;
self.onmessage = ({ data: { id, type, value } }) => {
  try {
    let result;
    if (type === 'open') {
      store = new CommandStore(
        fromV0(typeof value === 'string' ? JSON.parse(value) : value),
      );
      result = { doc: store.doc, patches: [] };
    } else if (type === 'compare') result = diff(value[0], value[1]);
    else if (type === 'proposal') {
      const p = store.preview(proposalCommand(value, store.doc));
      result = { scope: p.scope, diff: p.diff };
    } else if (type === 'preview') {
      const p = store.preview(value);
      result = { scope: p.scope, diff: p.diff };
    } else if (type === 'select') {
      const p = store.apply(value);
      result = { scope: p.scope, inverse: p.inverse };
    } else {
      const before = store.doc;
      let receipt;
      if (type === 'undo') store.undo();
      else if (type === 'redo') store.redo();
      else
        receipt = store.apply(
          type === 'apply-proposal' ? proposalCommand(value, store.doc) : value,
        );
      result = {
        patches: receipt
          ? [
              ...receipt.diff,
              {
                path: '/revision',
                before: before.revision,
                after: store.doc.revision,
              },
            ]
          : diff(before, store.doc),
        undo: store.past.length,
        redo: store.future.length,
      };
    }
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e.message });
  }
};
