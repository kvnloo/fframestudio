# Read-only folder import: privacy and storage footprint

Report: Android Chrome showed “Upload 3,805 files to this site?” after the page said
“nothing is uploaded”. Android Chrome has no `showDirectoryPicker`, so Studio uses
`<input webkitdirectory>`; Chrome words that picker as an upload. Nothing was sent
(CSP `connect-src` is self + loopback and the folder adapter makes no network call),
but `importFiles` copied every selected `File` into IndexedDB.

## Footprint, synthetic 3,000-file folder

`node tools/folder-import-footprint.mjs --site <built-site> --layout <layout>`: one
project (`project.json` + 3.4 MB proxy) among 2,998 × 16 KB files under `node_modules`,
`.git`, `target`, unreferenced `frames/` and `renders/`. Selected total 52,548,559 bytes.
CSP static server, system Chromium, fresh context, `navigator.storage.estimate()`
before import was 74,956 bytes.

| Build | Layout | Files kept | Blob bytes kept | Origin usage after |
|---|---|---:|---:|---:|
| origin/main `aba0198` | project.json at folder root | 3,000 | 52,548,559 | 54,297,804 |
| origin/main `aba0198` | `projects/<id>/` library | 1,200 | 23,057,359 | 23,807,180 |
| this branch | project.json at folder root | 2 | 3,429,327 | 3,511,500 |
| this branch | `projects/<id>/` library | 2 | 3,429,327 | 3,511,500 |

Every request in all four runs was a same-origin `GET`.

## Behaviour

- Only discovered `project.json` files and relative paths they reference are kept,
  in memory and IndexedDB. Other selected files are listed by path only, never read.
- Older records holding every selected file are pruned on the next visit.
- Copy before the picker explains the browser's “upload” wording; the shelf reports
  “Read N project files (size) of M selected; nothing sent over the network.”
- Without `showDirectoryPicker` the only action is **Choose a folder to read**, with
  no promise of saving to the folder.

Screenshots: `folder-privacy-before-390x780.png`, `folder-privacy-after-390x780.png`
(390×780, `showDirectoryPicker` removed to stand in for Android Chrome).

NOT VERIFIED: a real Android device and Chrome's native prompt (not capturable headlessly).
