// Local ACP fixture for recorded reviews. It never calls a model or a network service.
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

const logPath = process.argv[2];
const holdPath = process.argv[3];
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.id === undefined) continue;
  let result;
  if (message.method === 'initialize') result = { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'Review fixture', version: '1' } };
  else if (message.method === 'session/new') result = { sessionId: 'review-fixture' };
  else if (message.method === 'session/prompt') {
    const blocks = message.params.prompt || [];
    const text = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
    if (logPath) {
      fs.appendFileSync(logPath, JSON.stringify(blocks.map((block) => block.type === 'image'
        ? { type: 'image', mimeType: block.mimeType, bytes: block.data?.length || 0 }
        : { type: block.type, text: block.text || '' })) + '\n');
    }
    if (text.includes('__FAIL__')) {
      send({ id: message.id, error: { code: -32000, message: 'fixture refused' } });
      continue;
    }
    if (text.includes('__HOLD__')) {
      const started = Date.now();
      while (holdPath && !fs.existsSync(holdPath) && Date.now() - started < 15000) wait(50);
    }
    const target = text.match(/Write ONLY a proposal to (.+?)\. Format:/)?.[1];
    const source = text.match(/Read (.+?), schema /)?.[1];
    if (target && source && fs.existsSync(source)) {
      const { fromV0 } = await import('../../web/src/doc/project.js');
      const snapshot = text.match(/Working copy JSON: ([^\n]+)/)?.[1];
      const doc = snapshot ? JSON.parse(snapshot) : fromV0(JSON.parse(fs.readFileSync(source, 'utf8')));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify({
        schema: 'fframestudio.proposal/1',
        projectId: doc.id,
        baseRevision: doc.revision,
        title: 'Review fixture suggestion',
        commands: [{ type: 'edit-text', clipId: doc.videos[0].clips[0].id, field: 'title', value: 'Review fixture suggestion' }],
      }));
    }
    send({ method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'review fixture pong' } } } });
    result = { stopReason: 'end_turn' };
  } else {
    send({ id: message.id, error: { code: -32601, message: 'Unknown method' } });
    continue;
  }
  send({ id: message.id, result });
}
