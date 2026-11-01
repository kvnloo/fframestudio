import test from 'node:test';
import assert from 'node:assert/strict';
import { comfyIntent, parseIntent } from '../../web/src/intent.js';
import { ACTIONS, validateParams } from '../../web/src/actions.js';

const cases = [
  ['comfy, set prompt to a red fox in the snow', 'comfy-set-prompt', { prompt: 'a red fox in the snow' }],
  ['Set the prompt to "Neon Rain"', 'comfy-set-prompt', { prompt: 'Neon Rain' }],
  ['ComfyUI: steps twelve', 'comfy-set-param', { name: 'steps', value: 12 }],
  ['comfy seed 42', 'comfy-set-param', { name: 'seed', value: 42 }],
  ['comfy negative prompt blurry hands', 'comfy-set-param', { name: 'negative', value: 'blurry hands' }],
  ['comfy run', 'comfy-run', {}], ['run comfy', 'comfy-run', {}],
  ['more variations', 'comfy-variations', { count: 1 }], ['give me three more variations', 'comfy-variations', { count: 3 }],
  ['comfy cancel', 'comfy-cancel', {}], ['open comfy', 'comfy', {}], ['comfy use sdxl', 'comfy-use-template', { template: 'sdxl' }],
];
test('ComfyUI voice grammar maps utterances to typed actions whose params pass the registry schema', () => {
  for (const [said, id, params] of cases) {
    const r = comfyIntent(said, said.toLowerCase()); assert.deepEqual(r, { id, params }, said);
    assert.equal(ACTIONS[id].requires, 'comfy'); assert.equal(ACTIONS[id].command, false, 'never a proposal command');
    validateParams(ACTIONS[id].schema, params);
  }
});
test('bare verbs stay with the editor; unknown comfy phrases clarify instead of guessing', () => {
  for (const said of ['run', 'cancel', 'steps 12', 'change the text to "hi"', 'shorten the second shot by one second']) assert.equal(comfyIntent(said, said.toLowerCase()), null, said);
  assert.match(comfyIntent('comfy frobnicate', 'comfy frobnicate').clarification, /ComfyUI: say/);
  assert.match(comfyIntent('give me nine more variations', 'give me nine more variations').clarification, /one to four/);
  assert.match(comfyIntent('comfy steps lots', 'comfy steps lots').clarification, /number/);
});
test('without the bridge feature, ComfyUI utterances are refused honestly', () => {
  assert.deepEqual(parseIntent('comfy run', {}), { clarification: 'ComfyUI is not configured on this bridge.' });
  assert.throws(() => validateParams(ACTIONS['comfy-run'].schema, { count: 9 }), /range/);
  assert.throws(() => validateParams(ACTIONS['comfy-set-param'].schema, { name: 'Bad Name', value: 1 }), /invalid string/);
});
