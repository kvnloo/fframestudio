// Studio core: a song is an open document of lanes, and everything that reads or writes it is a
// plugin. One manifest shape for five kinds (docs/music-studio.md). Actions use fframestudio's
// actions.js shape (id, title, schema, apply), so the agent sees one manifest for every plugin and
// a kit is just a plugin with data and no code. Pure module: no DOM, no audio.

export const KINDS = ["source", "analyze", "voice", "skin", "export"];

// The document: what the studio knows about one track. Lanes carry up to three faces —
// sound (a stem file), notes (a transcription count) and voice (the kit now rendering it, or null
// for the original stem).
export function laneDoc(track, { stems = null, score = null, grid = {}, voices = {} } = {}) {
  const ks = new Set([...(stems?.stems ?? []).map((s) => s.k), ...(score?.lanes ?? []).map((l) => l.k)]);
  return {
    track: track.id, title: track.title, license: track.license, grid,
    lanes: [...ks].map((k) => ({ k, sound: stems?.stems?.find((s) => s.k === k)?.f ?? null, notes: score?.lanes?.find((l) => l.k === k)?.n ?? 0, voice: voices[k] ?? null })),
  };
}

const TYPES = { string: (v) => typeof v === "string", number: (v) => typeof v === "number" && isFinite(v), boolean: (v) => typeof v === "boolean", lane: (v) => typeof v === "string" && /^[a-z]+$/.test(v) };
function check(schema = {}, params = {}) {
  for (const [k, s] of Object.entries(schema)) {
    const v = params[k];
    if (v === undefined || v === null) { if (s.optional) continue; return `missing ${k}`; }
    if (!TYPES[s.type]?.(v)) return `${k} must be ${s.type}`;
    if (s.enum && !s.enum.includes(v)) return `${k} must be one of ${s.enum.join(", ")}`;
  }
  for (const k of Object.keys(params)) if (!(k in schema)) return `unknown ${k}`;
  return null;
}

export function createStudio(ctx = {}) {
  const plugins = new Map(), acts = new Map(), listeners = new Set();
  function register(p) {
    if (!p?.id || !/^[a-z0-9][a-z0-9.-]*$/.test(p.id)) throw new Error("plugin needs an id like kit.tr808");
    if (!KINDS.includes(p.kind)) throw new Error(`${p.id}: kind must be one of ${KINDS.join(", ")}`);
    if (!p.title || !p.license) throw new Error(`${p.id}: title and license are required`);
    if (plugins.has(p.id)) throw new Error(`${p.id}: already registered`);
    for (const a of p.actions ?? []) {
      const id = `${p.id}/${a.id}`; if (acts.has(id)) throw new Error(`${id}: duplicate action`);
      if (typeof a.apply !== "function") throw new Error(`${id}: apply() is required`);
      acts.set(id, { ...a, id, plugin: p.id });
    }
    plugins.set(p.id, p); emit({ type: "register", id: p.id });
    return p;
  }
  const emit = (e) => { for (const f of listeners) f(e); };
  return {
    register, ctx,
    get: (id) => plugins.get(id) ?? null,
    list: (kind) => [...plugins.values()].filter((p) => !kind || p.kind === kind),
    // What an agent (or the palette, or voice grammar) can do: data only, no functions.
    actionManifest: () => [...acts.values()].map(({ id, title, synonyms = [], schema = {}, destructive = false, plugin }) => ({ id, title, synonyms, schema, destructive, plugin })),
    // Run one command { id, params }: validated, applied, receipted. Bad input never reaches apply().
    async run(cmd) {
      const a = acts.get(cmd?.id); if (!a) return { ok: false, error: `no action ${cmd?.id}` };
      const err = check(a.schema, cmd.params ?? {}); if (err) return { ok: false, id: a.id, error: err };
      try { const out = await a.apply(ctx, cmd.params ?? {}); const r = { ok: true, id: a.id, params: cmd.params ?? {}, out: out ?? null }; emit({ type: "run", ...r }); return r; }
      catch (e) { return { ok: false, id: a.id, error: String(e?.message ?? e) }; }
    },
    // A proposal (fframestudio.proposal/1 shape, commands = [{ id, params }]) runs in order and stops at the first failure.
    async apply(proposal) {
      const done = [];
      for (const c of proposal?.commands ?? []) { const r = await this.run(c); done.push(r); if (!r.ok) break; }
      return done;
    },
    on: (f) => (listeners.add(f), () => listeners.delete(f)),
  };
}
