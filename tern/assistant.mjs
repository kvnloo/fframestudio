import { connect, ui, html, plain } from '@stencil-hq/tern';
import { readBridge, requestJSON } from './bridge-client.mjs';
import { editKey } from './composer.mjs';
import { connectACP } from './acp.mjs';
import { text, button, STYLE } from './views.mjs';

export function assistantView(state, actions) {
  const permission = state.permission;
  return {
    main: [html.div({ key: 'assistant', class: 'ffs-page' },
      html.h2({ key: 'title', text: 'ACP assistant', class: 'ffs-title' }),
      text('project', state.title), text('status', state.status),
      text('trust', 'Agents use your local login and can run tools. Review each permission request.'),
      ui.row({ key: 'agents', gap: 8 }, ...state.agents.filter(a => a.available).map(a => button(a.id, a.name, () => actions.connect(a.id)))),
      ...state.messages.map((m, i) => ui.card({ key: `message-${i}`, head: m.who }, text('body', m.text))),
      permission ? ui.card({ key: 'permission', head: permission.title },
        ...permission.options.map(o => button(o.optionId, o.name, () => permission.resolve(o.optionId))),
        button('deny', 'Deny', () => permission.resolve(null))) : null,
    )],
    dock: [ui.editor({ key: 'compose', text: state.draft, cursor: state.cursor, placeholder: 'Ask about this project', sendable: true, onEdit: actions.edit, onSend: e => actions.send(e.text) }),
      ui.row({ key: 'buttons', gap: 8 }, button('send', 'Send', () => actions.send(state.draft)), button('cancel', 'Cancel turn', actions.cancel)),
      text('keys', 'Enter sends · Esc closes · No agent connects until you choose one')],
  };
}

export async function runAssistant(info, id) {
  const project = await requestJSON(info, `/lib/${id}/project.json`);
  const agents = (await requestJSON(info, '/agents')).agents;
  const state = { title: project.title, agents, messages: [], status: 'Choose an agent', draft: '', cursor: 0, permission: null };
  const session = await connect({ app: 'fframestudio-assistant', version: '0.1.0', features: ['edit', 'send'] });
  if (!session) { console.log(plain(assistantView(state, {}))); return; }
  const surface = session.open({ id: 'assistant', mode: 'screen', title: 'fframestudio · ACP assistant', role: 'fframestudio.beta' });
  surface.stylesheet('fframestudio', STYLE);
  let agent, busy = false, closed = false;
  const render = () => { if (!closed) surface.render(assistantView(state, actions)); };
  // Do not await a model turn inside a TSP event handler: that deadlocks permission clicks.
  const task = work => { void work().catch(() => { state.status = 'Agent request failed; check the bridge and agent login'; busy = false; render(); }); };
  const actions = {
    connect: name => {
      if (busy) return;
      busy = true; agent?.close(); agent = null; state.status = `Connecting to ${name}…`; render();
      task(async () => {
        info = await readBridge();
        agent = await connectACP(info, id, name, {
          update: update => {
            if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
              const last = state.messages.at(-1);
              if (last?.who === 'Agent') last.text += update.content.text;
              else state.messages.push({ who: 'Agent', text: update.content.text });
            } else if (update.sessionUpdate === 'tool_call') state.messages.push({ who: 'Tool', text: `${update.title || update.kind} · ${update.status}` });
            render();
          },
          permission: request => new Promise(resolve => {
            if (closed) return resolve(null);
            state.permission = { title: request.toolCall?.title || 'Agent permission', options: request.options,
              resolve: choice => { state.permission = null; resolve(choice); render(); } };
            render();
          }),
          closed: () => { state.permission?.resolve(null); state.status = 'Agent disconnected'; render(); },
        });
        if (closed) { agent.close(); return; }
        state.status = `${name} ready`; busy = false; render(); surface.focus('dock.compose');
      });
    },
    edit: e => { state.draft = state.draft.slice(0, e.from) + e.text + state.draft.slice(e.to); state.cursor = e.cursor; render(); },
    send: value => {
      if (busy || !agent || !value.trim()) return;
      busy = true; state.draft = ''; state.cursor = 0; state.messages.push({ who: 'You', text: value }); state.status = 'Working…'; render();
      task(async () => { const result = await agent.prompt(value); busy = false; state.status = `Turn ended: ${result.stopReason}`; render(); });
    },
    cancel: () => { state.permission?.resolve(null); if (agent && busy) task(async () => { await agent.cancel(); }); },
  };
  try {
    render(); surface.focus('dock.compose');
    for await (const input of session) {
      if (input.type !== 'key') continue;
      if (input.key.name === 'escape' || (input.key.ctrl && input.key.name === 'c')) break;
      if (input.key.name === 'enter' && !input.key.shift) actions.send(state.draft);
      else { editKey(state, input.key); render(); }
    }
  } finally { closed = true; state.permission?.resolve(null); agent?.close(); await session.close(); }
}
