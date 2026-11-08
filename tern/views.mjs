import { ui, html } from '@stencil-hq/tern';

export const text = (key, value) => ui.text({ key, text: String(value ?? '') });
export const button = (key, label, action) => html.button({ key, text: label, onClick: action, class: 'ffs-button' });
export const time = seconds => {
  const t = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
};
const heading = (key, title) => html.h2({ key, text: title, class: 'ffs-title' });
const meta = (key, value) => html.p({ key, text: value, class: 'ffs-meta' });
export function libraryView(library, actions, posters = new Map()) {
  return html.div({ key: 'library', class: 'ffs-page' },
    heading('title', 'fframestudio / Library'),
    meta('meta', `${library.projects.length} projects · native beta-ui`),
    ...library.projects.map(p => html.div({ key: p.id, class: 'ffs-card ffs-library-card' },
      posters.has(p.id) ? ui.image({ key: 'poster', blob: posters.get(p.id), w: 160, h: 90, alt: p.title }) : null,
      html.div({ key: 'body', class: 'ffs-card-body' },
        heading('title', p.title),
        meta('details', `${p.kind} · ${time(p.duration_s)} · ${p.shots ?? 0} shots`),
        button('open', 'Open project', () => actions.open(p.id)),
      ),
    )),
    !library.projects.length ? text('empty', 'No imported projects. Run tools/import_projects.py from the repository.') : null,
  );
}

export function projectView(project, actions) {
  const shots = project.shots || [];
  return html.div({ key: 'project', class: 'ffs-page' },
    heading('title', project.title),
    meta('meta', `${project.kind} · ${time(project.duration_s ?? shots.at(-1)?.t1)} · ${shots.length} shots`),
    ui.row({ key: 'actions', gap: 10 }, button('editor', 'Open web editor', actions.editor), button('assistant', 'ACP assistant', actions.assistant)),
    heading('shots-title', 'Shot list'),
    ...shots.map(s => html.div({ key: `shot-${s.id}`, class: 'ffs-card' },
      text('title', `${s.name || s.id} · ${time(s.t0)} → ${time(s.t1)}`),
      ...Object.entries({ ...s.text, ...project.edits?.[s.id] }).map(([key, value]) => text(`field-${key}`, `${key}: ${Array.isArray(value) ? value.join(' / ') : typeof value === 'object' ? JSON.stringify(value) : value}`)),
    )),
    heading('notes-title', 'Review notes'),
    ...(project.notes?.length ? project.notes : ['No review notes.']).map((note, i) => text(`note-${i}`, typeof note === 'string' ? note : JSON.stringify(note))),
    meta('read-only', 'Native review is read-only. Edit shots and notes in the web app or with the assistant.'),
  );
}

export function queueView(projects) {
  return html.div({ key: 'queue', class: 'ffs-page' },
    heading('title', 'Render queue / status'),
    text('unavailable', 'No render scheduler is exposed by the bridge yet. This is an inventory of imported outputs, not a live queue.'),
    ...projects.map(p => html.div({ key: p.id, class: 'ffs-card' },
      heading('title', p.title),
      ...(p.renders?.length ? p.renders.map((r, i) => text(`render-${i}`, `Imported output · ${r.label || 'render'} · ${r.width ?? '?'}×${r.height ?? '?'} · ${r.fps ?? '?'} fps · ${time(r.duration_s)}`)) : [text('empty', 'No imported output')]),
    )),
  );
}

export const STYLE = `
.ffs-page { display: flex; flex-direction: column; padding: 20px; gap: 14px; }
.ffs-card { display: flex; flex-direction: column; padding: 16px; gap: 8px; border: 1px solid var(--sf-c-border); border-radius: 8px; }
.ffs-title { font-size: 21px; font-weight: 600; margin: 0; }
.ffs-meta { color: var(--sf-c-muted); margin: 0; }
.ffs-library-card { flex-direction: row; align-items: center; gap: 18px; }
.ffs-card-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ffs-button { align-self: flex-start; padding: 7px 12px; border: 1px solid var(--sf-c-border); border-radius: 5px; }
.ffs-button:hover { color: var(--sf-c-accent); }
.ffs-bar { padding: 10px 16px; gap: 10px; }
`;
