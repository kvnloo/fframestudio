#!/usr/bin/env node
import fs from 'node:fs';
import { parseCineticPicks } from '../web/src/video-style/cinetic.mjs';

const args = process.argv.slice(2);
try {
  if (args.length !== 1 || !args[0] || args[0].startsWith('-'))
    throw Error('Usage: node tools/import-cinetic-plan.mjs PATH_TO_PICKS_JSON');
  const stat = fs.statSync(args[0]);
  if (!stat.isFile() || stat.size > 131072) throw Error('Plan must be a file smaller than 128 KiB');
  const output = parseCineticPicks(fs.readFileSync(args[0], 'utf8'));
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
} catch (error) {
  process.stderr.write('cinetic: ' + error.message + '\n');
  process.exitCode = 1;
}
