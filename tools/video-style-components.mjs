#!/usr/bin/env node
import fs from 'node:fs';
import { VIDEO_STYLE_PRESETS, instantiate, evaluateRecipe, serializeRecipe, parseRecipe } from '../web/src/video-style/components.mjs';

const usage = 'Usage: video-style-components.mjs list | show NAME | export NAME [PROPS_JSON] [OPTIONS_JSON] | import FILE|- | eval NAME FRAME [PROPS_JSON] [OPTIONS_JSON] | eval FILE|- FRAME';
const args = process.argv.slice(2);
const [command, source, argument, propsJSON, optionsJSON] = args;
const load = source => parseRecipe(fs.readFileSync(source === '-' ? 0 : source, 'utf8'));
try {
  if (command === 'list' && args.length === 1) {
    for (const [id, d] of Object.entries(VIDEO_STYLE_PRESETS)) console.log(`${id}\t${d.version}\t${d.title}`);
  } else if (command === 'show' && args.length === 2 && Object.hasOwn(VIDEO_STYLE_PRESETS, source)) {
    console.log(JSON.stringify(VIDEO_STYLE_PRESETS[source], null, 2));
  } else if (command === 'export' && args.length >= 2 && args.length <= 4) {
    const recipe = instantiate(source, argument ? JSON.parse(argument) : {}, propsJSON ? JSON.parse(propsJSON) : {});
    console.log(serializeRecipe(recipe).trimEnd());
  } else if (command === 'import' && args.length === 2) {
    console.log(serializeRecipe(load(source)).trimEnd());
  } else if (['eval','frame'].includes(command) && args.length >= 3 && args.length <= 5) {
    if (!/^\d+$/.test(argument)) throw Error('Frame must be a nonnegative integer');
    const named = Object.hasOwn(VIDEO_STYLE_PRESETS, source);
    if (!named && args.length !== 3) throw Error('File evaluation takes no overrides; edit and import the recipe instead');
    const recipe = named ? instantiate(source, propsJSON ? JSON.parse(propsJSON) : {}, optionsJSON ? JSON.parse(optionsJSON) : {}) : load(source);
    console.log(JSON.stringify(evaluateRecipe(recipe, Number(argument)), null, 2));
  } else throw Error(usage);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
