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
// Named patterns so every surface speaks the same language: detent < tick < select < press < keep.
// Chrome on Android plays navigator.vibrate as a legacy one-shot at the motor's fixed strength (no
// amplitude), so length is the only intensity dial. Android's guidance puts a crisp key click at
// 10-20 ms; much shorter pulses barely move the actuator, so the scale starts at 8 ms.
const PAT = { detent: 8, tick: 10, select: 14, press: 18, keep: [16, 60, 24], cancel: [8, 50, 8], beat: 8, bar: 14 };
// A new vibrate cancels the one playing, so two calls in one gesture (press + audition, select +
// sheet snap) left only the second, often weaker, pulse. Within GAP ms the stronger pulse wins.
const RANK = { detent: 0, beat: 1, tick: 2, select: 3, cancel: 3, bar: 4, press: 5, keep: 6 }, GAP = 60;
let lastT = -1e9, lastR = -1;
export function haptic(kind = "tick") {
  const now = performance.now(), r = RANK[kind] ?? 2;
  if (now - lastT < GAP && r <= lastR) return;
  lastT = now; lastR = r;
  const p = typeof kind === "number" ? kind : PAT[kind] ?? 10;
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
