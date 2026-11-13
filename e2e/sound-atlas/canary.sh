#!/usr/bin/env bash
# Seed known defects into a built site so the suite's recall is measured, not assumed.
#   bash canary.sh <site-dir>     (bundle.sh calls it with CANARY=1)
# Each defect targets one journey; tests/journeys.e2e.ts must fail exactly those (see CANARY_EXPECT in README).
set -euo pipefail
out=$1
cat > "$out/canary.js" <<'JS'
// D1 blank map: the 2D context draws nothing
for (const k of ['fill', 'stroke', 'fillRect', 'drawImage', 'fillText', 'arc']) CanvasRenderingContext2D.prototype[k] = function () {};
// D2 search state lost: the URL never records the query
const rs = history.replaceState.bind(history);
history.replaceState = (s, t, u) => rs(s, t, String(u ?? '').replace(/([#&])q=[^&]*&?/, '$1'));
// D3 dishonest count: the first feeling chip over-reports by one
addEventListener('DOMContentLoaded', () => new MutationObserver(() => {
  const b = document.querySelector('#chips button'); const s = b && [...b.querySelectorAll('*')].reverse().find((e) => /^\d[\d,]*$/.test(e.textContent ?? ''));
  if (s && !s.dataset.c) { s.dataset.c = '1'; s.textContent = String(Number(s.textContent.replace(/,/g, '')) + 1); }
}).observe(document.body, { subtree: true, childList: true }));
// D4 a sort throws
addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#sortmenu button')) setTimeout(() => { throw new Error('canary: sort crashed'); }); }, true);
// D5 cast button dead
addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#pc')) e.stopImmediatePropagation(); }, true);
JS
sed -i 's|<head>|<head><script src="/canary.js"></script>|' "$out/index.html"
grep -q canary.js "$out/index.html"
