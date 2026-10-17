/** Basic pty keys remain program-owned even when Tern supports native edit events. */
export function editKey(state, key) {
  const value = state.draft, at = state.cursor;
  const before = [...value.slice(0, at)];
  const after = [...value.slice(at)];
  const prev = at - (before.at(-1)?.length || 0);
  const next = at + (after[0]?.length || 0);
  if (key.name === 'left') state.cursor = prev;
  else if (key.name === 'right') state.cursor = next;
  else if (key.name === 'home' || (key.ctrl && key.name === 'a')) state.cursor = 0;
  else if (key.name === 'end' || (key.ctrl && key.name === 'e')) state.cursor = value.length;
  else if (key.name === 'backspace') { state.draft = value.slice(0, prev) + value.slice(at); state.cursor = prev; }
  else if (key.name === 'delete') state.draft = value.slice(0, at) + value.slice(next);
  else if (key.text && !key.ctrl && !key.alt) { state.draft = value.slice(0, at) + key.text + value.slice(at); state.cursor += key.text.length; }
}
