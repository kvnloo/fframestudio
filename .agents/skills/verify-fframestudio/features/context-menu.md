# Context menu

Right-click opens a HUD menu for the clip, canvas, project card or workspace. Menus use the current shortcuts, support the keyboard and preserve the native text-editing menu in inputs, textareas and editable text. Editing actions share the editor's undo history.

## Sub-features

- `menu-target` offers the existing actions for a Story card, Timeline clip, Canvas or library card.
- `menu-workspace` offers Command palette, Workspace settings, Undo and Redo in empty space. Project-only actions are disabled in the library.
- `menu-native-text` keeps the native menu inside inputs (including browser-managed controls), textareas and contenteditable descendants.
- `menu-keyboard` opens with Shift+F10 or the ContextMenu key. Up/Down/Home/End move between enabled items; Enter/Space activate.
- `menu-close` closes on Escape, outside click, scrolling, resize or navigation. Escape returns focus to the invoking element.
- `menu-state` shows current keybindings, separators and disabled actions, including timing edits on beat-locked clips.
- `menu-position` keeps the menu within the viewport in dark, light and high-contrast themes.
- `menu-copy` copies the playhead's HH:MM:SS:FF non-drop timecode or a project's absolute source path.

## How to get to it (user POV)

- Right-click a Story card or Timeline clip to select, seek, play, focus an Inspector field or use an existing clip command.
- Right-click Canvas to play/pause, step a frame or copy timecode.
- Right-click a library card to open the project or copy its source path.
- Right-click empty space for workspace commands.
- Focus any of these targets and press Shift+F10 or the ContextMenu key.

## Driving it with Playwright

Preconditions:

- The demo editor has four clips, with a paused proxy and visible Timeline.
- Grant `clipboard-read` and `clipboard-write` to check copied values.

- **Open.** Run `await page.locator('#timeline .timeline-clip').nth(1).click({ button: 'right', position: { x: 30, y: 30 } });`. Assert `page.getByRole('menu', { name: 'Clip actions' })` is visible. Selection, playhead and document revision stay unchanged until activation.
- **Prevent the browser menu.** Dispatch a bubbling, cancelable `MouseEvent('contextmenu')` on the clip and assert `event.defaultPrevented`.
- **Keyboard seek.** Press Home, ArrowDown twice, then Enter. Assert `#preview-video.currentTime` equals 3 s within 0.05 s and the menu closes.
- **Restore focus.** Run `await clip.press('Shift+F10');` then Escape. Assert the menu is hidden and the clip equals `document.activeElement`.
- **Edit and undo.** Open with `clip.press('ContextMenu')`, focus `[data-menu-action="duplicate"]`, and press Space. Assert five clips. Activate menu Undo and Redo and assert four and five clips respectively. Undo again to restore four.
- **Disabled and custom bindings.** Lock the clip through `[data-menu-action="set-beat-lock"]` and check Delete/Split are disabled; Undo unlocks it. Change `[data-binding="duplicate"]` in Workspace and assert the menu's `kbd` text matches.
- **Edit title.** Collapse Inspector, open a Story card menu and activate `[data-menu-action="edit-text"]`. Assert the title input has focus and Inspector is visible.
- **Keep native text menus.** Dispatch cancelable contextmenu events on the title input, `#ask` textarea and a nested contenteditable span. Assert none is prevented.
- **Canvas.** Open `#canvas` with ContextMenu. Activate Next frame and Previous frame and assert the playhead. Copy timecode and read the clipboard. Play then Pause and assert the playback state.
- **Themes and bounds.** Select light, contrast and dark in Workspace. Dispatch contextmenu at the bottom-right corner and assert the entire menu bounding box fits the viewport. Capture each open menu.
- **Workspace.** Right-click `.ph-title` and activate Command palette or Workspace settings. Assert the matching dialog opens.
- **Library.** Return through `#crumbs a`, open a card menu, copy its source path and compare clipboard text with `project.json`. Check outside click closes it, then choose Open project and assert the editor loads.
- **Proof and timing.** `07-context-menu.png` and `07-context-menu-{dark,light,contrast}.png` show open menus. The journey measures ten real right-click opens, asserts both ready and rendering-opportunity durations are <16 ms, and records median/worst plus samples in `report.json` under `context_menu`, including on failure. `FFS_MENU_TRACE=1 npm run verify` additionally writes `context-menu-trace.json` for diagnosis; traced runs are separate from acceptance. See `docs/perf.md` for retained passes and the strict-budget tail failure.

## Gotchas

- Right-click does not select or seek until an item is activated. Clip edits target the card that opened the menu, even when another clip was selected.
- Split is disabled unless the playhead is inside the clip at an exact source-frame boundary. Beat locks disable timing edits and Delete.
- Library cards have no web re-import command. Project workspace commands require an open project.
- Clipboard access requires a secure context and browser permission. Local loopback origins qualify; copy failures appear as a toast.
- Menus can scroll on short viewports. Arrow navigation skips disabled items and separators.
- Timing ends in a task following the first animation frame after opening. It measures a rendering opportunity, not physical display presentation.
