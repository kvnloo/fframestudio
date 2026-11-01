# Node graph interaction — frame ledger and spec (2026-11-01)

Reference: @mrblackstudio, "Fitts's Law, magnetic attraction, and nodes that can't keep their hands
off each other" — x.com/mrblackstudio/status/2116825570252112336. 45.6 s, 2880×2160, 30 fps.
The video stays outside Git; the local copy, sha256, contact sheets and per-frame tiles are in
the project artifact store (`project-artifacts/fframestudio/references/mrblackstudio-2116825570252112336/`).
Author clarification in the thread: "the female node only reacts to its colour" — that is
the rule that keeps two nearby ports from competing.

Frame numbers below are at 30 fps. "seen" = visible in the frame tiles; "inferred" = what the
tiles imply but don't show directly.

| Frames | What happens (seen) | Implementation |
| --- | --- | --- |
| 450–470, 531–544, 600–618 | Hovering a port swaps its dot for a crosshair; the cursor is a crosshair. | `.ng-port:hover::after`, `cursor: crosshair` |
| 120–180 (0:04–0:06) | While a cable is being dragged, nodes with no port of that colour fade to about 30%. | `.ng-dim` on nodes with no compatible port |
| 42–47 | About 2–3 R from a matching port, a small translucent disc grows out of the port and a neck reaches toward a small blob around the cable tip. | `magnet()` halo = R·smoothstep from 3.0 R to 1.7 R; `metaballPath()` neck |
| 48–53, 546–571 | At about 1.7 R the disc is full size (R ≈ 1.05 × port spacing). The tip stays out on a neck while the pointer is held there. | capture at 1.7 R, release at 1.95 R (hysteresis) |
| 249–284 | Once the pointer is inside the disc, the tip sits at about 0.55 R from the port centre. The cursor is hidden throughout the drag. | `hold: 0.58`, capped at 0.62 R; `.ng-dragging { cursor: none }` |
| 285–288, 501–504, 572–576 | On release, the tip slides into the port and the disc collapses with it over about 4 frames (130 ms). | `collapseMs: 130` |
| 288–296, 505–515, 576–578 | A ring travels out from about 0.4 R to about 1.15 R, thinning as it fades over about 13 frames. On the red snap, two short arc sparks leave tangentially (574–575). | `ringMs: 430`, sparks for 300 ms |
| 472–500, 619–647 | Pressing a connected input lifts its cable. A full disc appears at once on the port the cable left, and dragging away stretches a neck. Releasing within range snaps the cable back with the same collapse and ring. | tether mode; tears at 2.05 R |
| 765–771 | A cable pulled from an input first curls (an overshoot "wiggle"), then settles into a smooth S. | spring-driven Bézier handles (240 Hz substeps) |
| unknown | What happens when a cable is dropped on empty canvas (not shown) | the cable reels back into its source over 220 ms |

## Scope in fframestudio

- `web/src/nodegraph.js` is a dependency-free engine with pure helpers (`metaballPath`,
  `magnet`, `compatible`, `spring`, `graphFromWorkflow`) and a `NodeGraph` DOM/SVG view.
- `web/labs/node-graph.html` reproduces the reference scene (Aphex Twin, Mapping, Glow Head,
  Mixer, Preview) for side-by-side tuning.
- The ComfyUI desk renders the selected registered template as a node graph. Socket colour
  follows the ComfyUI type: object_info output types when they are available, otherwise
  inference from known input names. **Rewiring is a local draft only**: Run still sends the
  template id and typed values, never the edited graph, so the desk's existing trust boundary is
  unchanged. Submitting edited graphs is an open decision for the owner.
- `prefers-reduced-motion` speeds up the effects 4×; springs still settle.

## Verification

- `node --test test/doc/nodegraph.test.mjs`: halo growth, hysteresis, the hold cap, metaball
  join/collapse/tear, the type rule, spring stability under long frames, and that every shipped
  template yields a typed, left-to-right graph whose links are all compatible.
- `node tools/node-graph-journey.mjs <dir>` drives the lab: connect, tug-and-snap-back, tear and
  drop, and a wrong-type drop. It saves frame strips and a webm. `lab-phases.png` holds our frames
  in the reference's phase order.
- `npm run test:comfy` (mock ComfyUI) now also asserts that the graph renders, that a tugged
  cable shows a halo and snaps back with the wiring unchanged, and that no console errors occur.
