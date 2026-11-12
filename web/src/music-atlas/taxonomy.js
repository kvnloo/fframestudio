// Music taxonomy for the Sound Atlas, filed four levels deep like the Taste Atlas
// (oss/taste-skill/examples/taste-atlas): 01 Feel (what the viewer should feel) -> 02 Family ->
// 03 Style -> 04 Track. Shared by the catalog builder (tools/music-catalog.mjs) and the browser.

export const LEVELS = ["FEEL", "FAMILY", "STYLE", "TRACK"];

// Colours follow the Taste Atlas operation palette (day, night).
export const FEELS = [
  { id: "drive", name: "Drive", color: "#d6453d", night: "#ff6b5f", ask: "momentum, chase, action", words: ["driving", "intense", "action", "aggressive", "epic", "energetic", "powerful", "hard", "fast", "chase", "heroic", "battle"] },
  { id: "lift", name: "Lift", color: "#c27c0e", night: "#ffbf4d", ask: "bright, hopeful, rising", words: ["uplifting", "bright", "happy", "hopeful", "inspiring", "positive", "sunny", "optimistic", "triumphant", "joyful", "upbeat"] },
  { id: "play", name: "Play", color: "#c2457a", night: "#ff86b8", ask: "bouncy, cute, funny", words: ["bouncy", "humorous", "playful", "quirky", "fun", "silly", "cute", "comedy", "cartoon", "whimsical"] },
  { id: "groove", name: "Groove", color: "#2f6fd6", night: "#6ea8ff", ask: "head-nod, cool, rhythmic", words: ["grooving", "groovy", "funky", "cool", "swing", "danceable", "rhythmic", "smooth", "dance"] },
  { id: "calm", name: "Calm", color: "#1f8a5b", night: "#4fd69a", ask: "soft, relaxed, warm", words: ["calming", "relaxed", "relaxing", "chill", "mellow", "peaceful", "gentle", "soft", "dreamy", "lofi", "warm", "tranquil"] },
  { id: "wonder", name: "Wonder", color: "#7b3fa0", night: "#c38bff", ask: "mystery, space, magic", words: ["mysterious", "mystical", "magical", "ethereal", "space", "cosmic", "wonder", "fantasy", "floating", "atmospheric"] },
  { id: "shadow", name: "Shadow", color: "#2b8a93", night: "#5fd3dc", ask: "dark, tense, sombre", words: ["dark", "eerie", "unnerving", "suspenseful", "somber", "sad", "melancholy", "tense", "horror", "ominous", "creepy", "haunting"] },
];

// What each visual channel means, everywhere on the page:
//   hue        = ring 1 (feel, or the lens group)      tint (hue/lightness shift) = ring 2 (family)
//   Archivo Black = groups · Instrument Sans = names · IBM Plex Mono = measurements
//   Instrument Serif italic = the work itself (track titles) and why it was suggested
//   motion     = the playing track's metre: beat -> its dot, bar -> its lineage, phrase -> its wedge
// Family tints [hue deg, lightness %] shift a feel's colour the same way in every feel, so a shade
// reads as a kind of sound: warmer = organic / acoustic, cooler = synthetic, lighter = airy,
// deeper = heavy or orchestral.
export const FAMILY_TINT = { electronic: [16, 6], retro: [26, 12], beats: [10, -8], ambient: [4, 16], cinematic: [-6, -13], rockpop: [-12, -5], jazzfunk: [-18, 4], world: [-26, 10] };
const toRgb = (c) => {
  let m = /^#([0-9a-f]{6})$/i.exec(c); if (m) { const v = parseInt(m[1], 16); return [v >> 16, (v >> 8) & 255, v & 255]; }
  m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c); if (m) return m.slice(1).map(Number);
  m = /^hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)$/.exec(c); if (m) return { h: +m[1], s: +m[2], l: +m[3] };
  return null;
};
// Shift a colour (hex, rgb() or hsl()) by [hue deg, lightness %]; returns hsl().
export function shade(c, [dh, dl] = [0, 0]) {
  let v = toRgb(c); if (!v) return c;
  if (Array.isArray(v)) { const [r, g, b] = v.map((x) => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0, h = !d ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    v = { h: h * 60, s: s * 100, l: l * 100 }; }
  return `hsl(${Math.round((v.h + dh + 360) % 360)},${Math.round(v.s)}%,${Math.round(Math.max(18, Math.min(88, v.l + dl)))}%)`;
}

// Families and their styles. `re` matches the track's text (title, tags, instruments, description).
export const FAMILIES = [
  { id: "electronic", name: "Electronic", re: /electr|synth|edm|techno|house|trance|chip|8.?bit|dubstep|dnb|drum.?and.?bass|idm|glitch|disco|dance|club|future|electronica/, styles: [
    ["chiptune", "Chiptune", /chip|8.?bit|16.?bit|nes\b|game ?boy|retro ?game|video ?game|arcade|square ?wave/],
    ["synthwave", "Synthwave", /synthwave|outrun|retrowave|80s|eighties|vaporwave|retro ?synth/],
    ["dance", "House & Dance", /house|edm|club|dance|disco|techno|trance|four.?on/],
    ["breaks", "Breaks & Bass", /dubstep|dnb|drum.?and.?bass|breakbeat|breaks|jungle|bass ?music|trap/],
    ["electropop", "Electro Pop", /electro.?pop|synth.?pop|pop|future ?bass|indietronica/],
    ["idm", "Glitch & IDM", /idm|glitch|experimental|minimal|clicks/],
    ["electronica", "Electronica", /./],
  ] },
  { id: "cinematic", name: "Cinematic", re: /soundtrack|cinematic|orchestr|film|trailer|score|classical|strings|epic|symphon/, styles: [
    ["epic", "Epic & Trailer", /epic|trailer|heroic|battle|anthem|triumph|brass/],
    ["suspense", "Suspense", /suspense|tension|horror|thriller|eerie|creepy|dark/],
    ["piano", "Piano", /piano/],
    ["orchestral", "Orchestral", /orchestr|strings|symphon|classical|violin|cello|choir/],
    ["adventure", "Adventure", /./],
  ] },
  { id: "rockpop", name: "Rock & Pop", re: /rock|pop|indie|punk|metal|surf|guitar|band/, styles: [
    ["rock", "Rock", /rock|metal|punk|grunge|distort/],
    ["surf", "Surf & Retro", /surf|rockabilly|60s|garage/],
    ["indie", "Indie", /indie|alternative|acoustic/],
    ["pop", "Pop", /./],
  ] },
  { id: "jazzfunk", name: "Jazz & Funk", re: /jazz|funk|blues|swing|soul|lounge|bossa|r.?n.?b/, styles: [
    ["funk", "Funk & Soul", /funk|soul|r.?n.?b|disco/],
    ["swing", "Swing", /swing|big ?band|ragtime/],
    ["blues", "Blues", /blues/],
    ["lounge", "Lounge", /lounge|bossa|cocktail|easy/],
    ["jazz", "Jazz", /./],
  ] },
  { id: "beats", name: "Beats", re: /hip.?hop|lo.?fi|trip.?hop|beat|rap|urban|boom.?bap|downtempo/, styles: [
    ["lofi", "Lo-fi", /lo.?fi|chill.?hop|study|vinyl/],
    ["triphop", "Trip-hop & Downtempo", /trip.?hop|downtempo|chill/],
    ["hiphop", "Hip-hop", /./],
  ] },
  { id: "ambient", name: "Ambient", re: /ambient|drone|atmospher|pad|meditat|new ?age|soundscape|space/, styles: [
    ["space", "Space", /space|cosmic|stars|sci.?fi|galax/],
    ["drone", "Drone & Texture", /drone|texture|noise|dark ?ambient/],
    ["pads", "Pads & Calm", /./],
  ] },
  { id: "world", name: "World & Folk", re: /world|folk|celtic|latin|african|asian|reggae|ska|medieval|acoustic|ethnic|tribal|middle ?east|irish/, styles: [
    ["celtic", "Celtic & Medieval", /celtic|irish|medieval|ren faire|renaissance|lute/],
    ["latin", "Latin", /latin|salsa|tango|bossa|mexic|spanish|flamenco/],
    ["reggae", "Reggae & Ska", /reggae|ska|dub\b/],
    ["asia", "Asia & Middle East", /asian|japan|chin|india|arab|middle ?east|koto|sitar/],
    ["folk", "Folk & Acoustic", /./],
  ] },
  { id: "retro", name: "Retro & Fun", re: /silent|polka|ragtime|holiday|christmas|musical|vaudeville|circus|comedy|cartoon/, styles: [
    ["silent", "Silent Film", /silent|ragtime|vaudeville/],
    ["holiday", "Holiday", /holiday|christmas|xmas|halloween/],
    ["cartoon", "Cartoon & Circus", /./],
  ] },
];

// Incompetech genre ids (from its music.html lookup) -> family. Stings (23) are dropped upstream.
export const INCOMPETECH_GENRE = { 2: "African", 3: "Blues", 4: "Classical", 5: "Contemporary", 6: "Disco", 7: "Electronica", 8: "Funk", 9: "Holiday", 10: "Horror", 11: "Jazz", 12: "Latin", 13: "Modern", 14: "Musical", 15: "Polka", 16: "Pop", 18: "Reggae", 19: "Rock", 20: "Silent Film Score", 21: "Ska", 22: "Soundtrack", 23: "Stings", 24: "Unclassifiable", 25: "World", 26: "Urban" };
const GENRE_FAMILY = { African: "world", Blues: "jazzfunk", Classical: "cinematic", Contemporary: "cinematic", Disco: "electronic", Electronica: "electronic", Funk: "jazzfunk", Holiday: "retro", Horror: "cinematic", Jazz: "jazzfunk", Latin: "world", Modern: "rockpop", Musical: "retro", Polka: "retro", Pop: "rockpop", Reggae: "world", Rock: "rockpop", "Silent Film Score": "retro", Ska: "world", Soundtrack: "cinematic", World: "world", Urban: "beats" };

export const BPM_BANDS = [
  { id: "slow", name: "Slow", lo: 0, hi: 90 },
  { id: "mid", name: "Mid", lo: 90, hi: 115 },
  { id: "up", name: "Up", lo: 115, hi: 135 },
  { id: "fast", name: "Fast", lo: 135, hi: 160 },
  { id: "rush", name: "Rush", lo: 160, hi: 999 },
];
export const bpmBand = (bpm) => (bpm ? BPM_BANDS.find((b) => bpm >= b.lo && bpm < b.hi)?.id : null);

const words = (s) => (s || "").toLowerCase();

// Classify one track from its text. Returns { feel, feels, family, style }.
// `hint` may carry { genre, feelList } from a source with structured metadata.
export function classify(text, hint = {}) {
  const t = words(text);
  const feelList = (hint.feelList || []).map(words);
  const feels = [];
  for (const f of feelList) { const m = FEELS.find((F) => F.words.some((w) => f.includes(w))); if (m && !feels.includes(m.id)) feels.push(m.id); }
  const scored = FEELS.map((F) => [F.id, F.words.reduce((a, w) => a + (new RegExp(`\\b${w}`).test(t) ? 1 : 0), 0)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  for (const [id] of scored) if (!feels.includes(id)) feels.push(id);
  let family = hint.genre && GENRE_FAMILY[hint.genre];
  if (hint.genre === "Unclassifiable" || !family) family = FAMILIES.find((F) => F.re.test(t))?.id;
  family ??= /synth|electr/.test(t) ? "electronic" : "ambient";
  const fam = FAMILIES.find((F) => F.id === family);
  const style = (hint.genre === "Horror" ? fam.styles.find((s) => s[0] === "suspense") : null) ?? fam.styles.find(([, , re]) => re.test(t)) ?? fam.styles[0];
  return { feel: feels[0] ?? (family === "ambient" ? "calm" : "groove"), feels, family, style: style[0] };
}

export const familyById = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));
export const feelById = Object.fromEntries(FEELS.map((f) => [f.id, f]));
export const styleName = (family, style) => familyById[family]?.styles.find((s) => s[0] === style)?.[1] ?? style;

// Owner shorthand -> words the catalogue actually uses (semantic search gets both).
export const EXPANSIONS = [
  [/geometry ?dash|\bgd\b/, "energetic fast electronic dance synth chiptune game bouncy bright driving"],
  [/lo.?fi|study/, "lofi chill hip hop mellow relaxed beats"],
  [/launch|product ?video|promo|demo/, "uplifting bright driving modern electronic corporate positive"],
  [/clean/, "clean bright crisp modern electronic minimal"],
  [/hype|banger/, "intense driving energetic action dance"],
  [/sad|cry/, "somber sad melancholy piano"],
  [/spooky|scary/, "eerie dark horror suspense"],
];
export const expand = (q) => { const s = words(q); return [s, ...EXPANSIONS.filter(([re]) => re.test(s)).map(([, x]) => x)].join(" "); };
