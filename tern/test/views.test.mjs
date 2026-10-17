import test from 'node:test';
import assert from 'node:assert/strict';
import { plain, View } from '@stencil-hq/tern';

test('native library shows every project, metadata and a usable open action', async () => {
  const { libraryView } = await import('../views.mjs');
  let opened;
  const view = libraryView({ projects: [{ id: 'film', title: 'Native film', kind: 'html-film', duration_s: 30.25, shots: 5 }] }, { open: id => { opened = id; } });
  const text = plain(view);
  for (const value of ['Native film', 'html-film', '0:30.25', '5 shots']) assert.ok(text.includes(value), text);
  const document = View.from(view);
  assert.ok(document);
  const visit = n => { if (n?.handlers?.onClick) n.handlers.onClick({}); for (const c of n?.children || []) visit(c); };
  visit(view);
  assert.equal(opened, 'film');
  assert.match(text, /Open project/);
});

test('project view merges edits, preserves array text and shows review notes and precise times', async () => {
  const { projectView } = await import('../views.mjs');
  const project = { id: 'film', title: 'Film', kind: 'fframes', shots: [{ id: 's1', name: 'Hook', t0: 0, t1: 1.25, text: { head: ['Original', 'line'], body: 'unchanged' } }], edits: { s1: { head: ['Edited', 'headline'] } }, notes: ['Review the pacing'] };
  const view = projectView(project, { editor() {}, assistant() {} });
  const t = plain(view);
  for (const value of ['Edited', 'headline', 'unchanged', '0:01.25', 'Review the pacing', 'Open web editor', 'ACP assistant']) assert.ok(t.includes(value), t);
  assert.ok(!t.includes('Original'));
  View.from(view);
});

test('render status reports imported outputs, not fictional active jobs', async () => {
  const { queueView } = await import('../views.mjs');
  const view = queueView([{ id: 'film', title: 'Film', renders: [{ label: 'master', duration_s: 30, width: 1920, height: 1080, fps: 60 }] }]);
  const t = plain(view);
  assert.match(t, /No render scheduler/);
  assert.match(t, /master/);
  assert.match(t, /Imported output/);
  View.from(view);
});
