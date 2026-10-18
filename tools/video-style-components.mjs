#!/usr/bin/env node
import { VIDEO_STYLE_PRESETS, instantiate, evaluateRecipe, serializeRecipe } from '../web/src/video-style/components.mjs';

const [command, name, arg] = process.argv.slice(2);
try {
  if (command === 'list') {
    for (const [id, preset] of Object.entries(VIDEO_STYLE_PRESETS)) console.log(id + "\t" + preset.title);
  } else if (command === 'export') {
    const changes = arg ? JSON.parse(arg) : {};
    console.log(serializeRecipe(instantiate(name, changes)).trimEnd());
  } else if (command === 'frame') {
    console.log(JSON.stringify(evaluateRecipe(instantiate(name), Number(arg)), null, 2));
  } else {
    throw Error('Usage: node tools/video-style-components.mjs list | export NAME [PROPS_JSON] | frame NAME FRAME');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
