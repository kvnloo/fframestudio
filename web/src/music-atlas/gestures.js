// Touch feel: haptics and press-and-hold ("force touch") shared by the atlas, the list and the player.
//
// Haptics: Android/Chrome has navigator.vibrate. iOS Safari has none, but from iOS 18 toggling a
// native <input type=checkbox switch> plays the system tick, so taps fall back to that.
// Press: a hold of HOLD ms, or pressing harder where the screen reports pressure (old 3D Touch,
// some Android panels report contact growth), fires. A ring grows under the finger while arming;
// moving more than SLOP px first means a scroll or pan, so the press quietly cancels.
export const HOLD = 420, SLOP = 8, FORCE = 0.22;

const ios = (() => {
  if (navigator.vibrate) return null;
  const label = document.createElement("label"), input = document.createElement("input");
  input.type = "checkbox"; input.setAttribute("switch", ""); label.append(input);
  label.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9px;top:0";
  document.body.append(label);
  return label;
})();
// One word per meaning, so a hand learns them. Chrome on Android plays navigator.vibrate at the motor's
// fixed strength (no amplitude), so only length, count and rhythm can differ, and neighbours sit >= 1.6x
// apart (8/10/14 ms all felt the same). touch: reversible navigation. land: something arrived (the first
// sound). press: a hold fired. keep / release: committed / undone, mirror rhythms. error: failed, the only
// triple. beat / bar: metre, inside a hold only.
const PAT = { touch: 12, land: 22, press: 35, keep: [16, 60, 30], release: [24, 60, 12], error: [12, 40, 12, 40, 12], beat: 10, bar: 20 };
const ALIAS = { detent: "touch", tick: "touch", select: "touch", cancel: "release" }; // older call sites
// A new vibrate cuts the one playing, so while a pattern is still running (+20 ms) only a stronger one may
// interrupt it: a flat 60 ms window let a touch cut keep's tail.
const RANK = { touch: 0, beat: 1, land: 2, bar: 2, release: 3, press: 4, error: 5, keep: 5 };
const span = (p) => (Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : p) + 20;
let lastT = -1e9, lastR = -1, lastS = 0;
export function haptic(kind = "touch") {
  kind = ALIAS[kind] ?? kind;
  const now = performance.now(), r = RANK[kind] ?? 0, p = PAT[kind] ?? PAT.touch;
  if (now - lastT < lastS && r <= lastR) return;
  lastT = now; lastR = r; lastS = span(p);
  if (navigator.vibrate) { try { navigator.vibrate(p); } catch {} return; }
  ios?.click(); // one system tick, whatever the pattern
}

// The ring that grows under a finger. One element for the page; transform/opacity only.
const ring = Object.assign(document.createElement("div"), { className: "press" });
ring.setAttribute("aria-hidden", "true");
document.body.append(ring);
export const pressRing = {
  arm(x, y, color) { ring.style.translate = `${x}px ${y}px`; if (color) ring.style.setProperty("--c", color); ring.classList.remove("on", "out"); void ring.offsetWidth; ring.classList.add("arm"); },
  fire(color) { if (color) ring.style.setProperty("--c", color); ring.classList.add("on"); },
  move(x, y) { ring.style.translate = `${x}px ${y}px`; },
  pulse(k) { ring.style.scale = (1 + 0.22 * k).toFixed(3); },
  hide() { ring.classList.remove("arm", "on"); ring.classList.add("out"); ring.style.scale = ""; },
};

// Press-and-hold on elements matching `sel` inside `root`. Callbacks get (el, event).
// After a fire the following click is swallowed, so a held row doesn't also "tap".
export function pressable(root, sel, { onFire, onEnd, color }) {
  let p = null, swallow = false;
  const clear = () => { clearTimeout(p?.t); clearTimeout(p?.a); };
  const fire = () => { if (!p || p.on) return; p.on = true; swallow = true; haptic("press"); pressRing.fire(color?.(p.el)); onFire?.(p.el, p.e); };
  root.addEventListener("pointerdown", (e) => {
    swallow = false;
    const el = e.target.closest(sel); if (!el || e.button > 0 || e.target.closest("[data-heart], input")) return;
    p = { el, e, x: e.clientX, y: e.clientY, p0: e.pressure, on: false };
    p.a = setTimeout(() => p && pressRing.arm(p.x, p.y, color?.(el)), 110);
    p.t = setTimeout(fire, HOLD);
  });
  root.addEventListener("pointermove", (e) => {
    if (!p) return;
    if (p.on) { pressRing.move(e.clientX, e.clientY); return; }
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) { clear(); pressRing.hide(); p = null; return; }
    if (e.pointerType !== "mouse" && p.p0 > 0 && e.pressure - p.p0 > FORCE) { clear(); fire(); } // pressed harder
  });
  const up = (e) => { if (!p) return; clear(); const was = p; p = null; pressRing.hide(); if (was.on) onEnd?.(was.el, e, e.type === "pointercancel"); };
  root.addEventListener("pointerup", up); root.addEventListener("pointercancel", up);
  root.addEventListener("click", (e) => { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
  root.addEventListener("contextmenu", (e) => { if (e.target.closest(sel)) e.preventDefault(); });
}
