#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { connect, ui, plain } from '@stencil-hq/tern';
import { controlFile } from './tern-control.mjs';
import { ensureBridge } from './lifecycle.mjs';
import { readBridge, requestJSON, editorURL, projectID } from './bridge-client.mjs';
import { libraryView, projectView, queueView, text, button, STYLE } from './views.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('fframestudio native beta-ui: node tern/app.mjs [--project ID | --queue | --assistant ID] [--plain]\nLibrary is the default. Requires Node 22+; TSP falls back to read-only text outside Tern.');
  process.exit(0);
}
let session;
try {
  let info = await ensureBridge();
  let mode = args.includes('--queue') ? 'queue' : args.includes('--project') ? 'project' : 'library';
  let id = args.includes('--project') ? projectID(args[args.indexOf('--project') + 1]) : null;
  if (args.includes('--assistant')) {
    const { runAssistant } = await import('./assistant.mjs');
    await runAssistant(info, projectID(args[args.indexOf('--assistant') + 1]));
  } else {
    let data, status = '', loading = false;
    const posters = new Map();
    session = args.includes('--plain') ? null : await connect({ app: 'fframestudio', version: '0.1.0' });
    const surface = session?.open({ id: 'fframestudio', mode: 'screen', title: 'fframestudio · beta-ui', role: 'fframestudio.beta' });
    surface?.stylesheet('fframestudio', STYLE);
    const run = async (action) => {
      if (loading) return;
      loading = true;
      try { await action(); status = ''; } catch (e) { status = e.message; }
      finally { loading = false; render(); }
    };
    const load = async () => {
      info = await readBridge();
      if (!info) throw new Error('Bridge discovery is missing');
      if (mode === 'project') data = await requestJSON(info, `/lib/${projectID(id)}/project.json`);
      else {
        const library = await requestJSON(info, '/lib/library.json');
        data = mode === 'queue' ? await Promise.all(library.projects.map(p => requestJSON(info, `/lib/${projectID(p.id)}/project.json`))) : library;
        if (mode === 'library' && session?.caps.kinds.includes('image')) {
          for (const p of library.projects) {
            if (!p.poster || posters.has(p.id) || p.poster.startsWith('/') || p.poster.split('/').includes('..')) continue;
            try {
              const res = await fetch(`${info.url}/lib/${p.poster.split('/').map(encodeURIComponent).join('/')}`, { headers: { Authorization: `Bearer ${info.token}` }, redirect: 'error', signal: AbortSignal.timeout(3000) });
              if (res.ok && Number(res.headers.get('content-length')) < 4e6) {
                const bytes = new Uint8Array(await res.arrayBuffer());
                if (bytes.length < 4e6) posters.set(p.id, session.blob(bytes, res.headers.get('content-type') || 'image/jpeg'));
              }
            } catch { /* Missing artwork must not prevent reviewing the library. */ }
          }
        }
      }
    };
    const navigate = (next, project) => run(async () => { mode = next; id = project; await load(); surface?.scroll('main', 'top'); });
    const actions = {
      open: project => navigate('project', project),
      editor: () => run(async () => {
        if (!process.env.TERN_PANE) throw new Error('Open the editor from a native Tern window');
        const fresh = await readBridge();
        // The credential never appears in argv, stdout or a surface recording.
        await controlFile(`browser open ${JSON.stringify(editorURL(fresh, id))}\n`, argv => tern(argv));
      }),
      assistant: () => run(async () => {
        const pane = process.env.TERN_PANE;
        if (!pane) throw new Error('Open the assistant from a native Tern pane');
        await tern(['split', pane, 'right', '--', process.execPath, fileURLToPath(import.meta.url), '--assistant', projectID(id)]);
      }),
    };
    function view() { return mode === 'project' ? projectView(data, actions) : mode === 'queue' ? queueView(data) : libraryView(data, actions, posters); }
    function render() {
      if (!surface || !data) return;
      surface.render({ main: status ? [text('error', status)] : [view()], dock: [ui.row({ key: 'navigation', class: 'ffs-bar' },
        button('library', 'Library', () => navigate('library')),
        button('queue', 'Render status', () => navigate('queue')),
        button('refresh', 'Refresh', () => run(load)),
        button('quit', 'Close', () => session.close()),
      ), text('status', status || 'Read-only native review · R refresh · L library · Q close')] });
    }
    await load();
    if (!session) console.log(plain(view()));
    else {
      render();
      for await (const input of session) {
        if (input.type === 'event' && input.event.ev === 'error') { status = 'Tern could not draw part of this view'; render(); }
        if (input.type !== 'key') continue;
        const key = input.key;
        if (key.name === 'escape' || key.name === 'q' || (key.ctrl && key.name === 'c')) break;
        if (key.name === 'r') await run(load);
        if (key.name === 'l') await navigate('library');
      }
    }
  }
} catch (error) {
  // Do not include exception objects/requests: they can contain bridge credentials.
  console.error(`fframestudio: ${String(error.message).replace(/token=[^\s&]+/g, 'token=<redacted>')}`);
  process.exitCode = 1;
} finally { await session?.close(); }

function tern(argv, input = '') {
  const binary = process.env.FFS_TERN_BIN || path.join(process.env.HOME, '.local/bin/tern');
  return new Promise((resolve, reject) => {
    const child = spawn(binary, argv, { stdio: ['pipe', 'ignore', 'ignore'] });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Tern operation timed out')); }, 15000);
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('error', () => { clearTimeout(timeout); reject(new Error('Cannot run Tern CLI')); });
    child.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Tern could not open the requested pane')); });
  });
}
