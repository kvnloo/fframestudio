#!/usr/bin/env node
// Fail when a project in the library would preview several distinct scenes as the same page.
//   node tools/check-distinct-pages.mjs [library-root | project.json ...]
// Default root: $FFS_LIBRARY or ~/fframestudio/projects. Read-only; exit 1 on any duplicate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromV0, duplicateStills } from '../web/src/doc/project.js';

const args = process.argv.slice(2);
const root = process.env.FFS_LIBRARY || path.join(os.homedir(), 'fframestudio/projects');
const files = (args.length ? args : [root]).flatMap((p) =>
  p.endsWith('.json') ? [p] : fs.readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(p, d.name, 'project.json')))
    .map((d) => path.join(p, d.name, 'project.json')));
let bad = 0;
for (const file of files) {
  let doc;
  try { doc = fromV0(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (e) { console.log(`skip ${file}: ${e.message}`); continue; }
  const groups = duplicateStills(doc);
  if (groups.length) {
    bad++;
    console.log(`FAIL ${doc.id}: scenes share one preview page: ${groups.map((g) => g.join(',')).join(' | ')}`);
  } else console.log(`ok   ${doc.id}: ${doc.videos.reduce((n, v) => n + v.clips.length, 0)} clips`);
}
process.exit(bad ? 1 : 0);
