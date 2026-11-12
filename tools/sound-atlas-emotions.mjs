#!/usr/bin/env node
// Re-file an already-built catalogue under the current emotion taxonomy (Tense split into Sad and
// Tense) without re-fetching or re-embedding the sources. Fresh builds (tools/music-catalog.mjs)
// classify with the new words directly. Usage: node tools/sound-atlas-emotions.mjs <catalog-dir>/catalog.json
import { readFileSync, writeFileSync } from "node:fs";
import { feelById } from "../web/src/music-atlas/taxonomy.js";

const path = process.argv[2];
if (!path) { console.error("usage: sound-atlas-emotions.mjs <catalog.json>"); process.exit(2); }
const cat = JSON.parse(readFileSync(path, "utf8"));
// Only the dark corner splits: a Tense track whose tags lean to sorrow (somber, melancholy...) more
// than to dread (eerie, unnerving, horror...) moves to Sad. "dark" names both, so it is not counted.
// Every other emotion stays exactly as built.
const SAD = feelById.sad.words, TENSE = feelById.shadow.words.filter((w) => w !== "dark");
const hits = (tags, list) => tags.filter((g) => list.some((w) => g.includes(w))).length;
const moved = { "shadow->sad": 0 };
for (const t of cat.tracks) {
  if (t.feel !== "shadow") continue;
  const tags = (t.tags ?? []).map((g) => g.toLowerCase());
  const text = [t.title, t.desc].join(" ").toLowerCase();
  const s = hits(tags, SAD) + SAD.filter((w) => new RegExp(`\\b${w}`).test(text)).length;
  const d = hits(tags, TENSE) + TENSE.filter((w) => new RegExp(`\\b${w}`).test(text)).length;
  if (s > d) { t.feel = "sad"; t.feels = ["sad", ...(t.feels ?? []).filter((f) => f !== "sad")]; delete t.feelGuess; moved["shadow->sad"]++; }
}
writeFileSync(path, JSON.stringify(cat));
console.log(JSON.stringify(moved));
