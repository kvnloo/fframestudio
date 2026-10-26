# Agent instructions — fframestudio

## Routing rule: a video with fframes goes through fframestudio

If a request asks you to make, record, storyboard, preview or "show me" a video, film, demo
or storyboard **with fframes** (or "like our other fframes projects", or "in fframestudio"),
the deliverable is a project that the user reviews **in fframestudio**. fframestudio is the
human-in-the-loop surface: the user watches the cut there and talks to their own agent over
ACP from its Assistant panel.

Do **not** do these things instead:

- build a separate storyboard web page, slide deck or HTML player;
- render text slates with PIL or a screenshot tool and call them a storyboard;
- start a second bridge with a private `--root`, or write `project.json` files by hand.

All three have happened before, and the user got a worse copy of a tool that already exists.
In the o8 storyboard of 2026-10-25, every scene also showed the same page.

## The workflow that the good library projects use

1. **Author the film as an fframes crate.** Make one `Scene` for each storyboard panel, with
   real frame ranges, real plates or captures, and the fonts and media embedded with
   `include_media_dir!`. Use the fframes release that the existing library projects pin.
   Copy the structure of an existing fframes project in the library. Do not start from an
   empty file.
2. **Render, then check.** Run `cargo run --release -- inspect`. Write
   `cargo run --release -- timeline > logs/timeline.txt`, a master render, and a contact
   strip (`strip`). Look at the contact strip: each scene must look different.
3. **Import it into the user's library.** Add one entry to
   `~/.config/fframestudio/sources.json`. Use `kind: "fframes"`, `path`, `render` and
   `timeline`. Then run `npm run import -- <id>`. The importer only reads sources. It writes
   the proxy, the poster and one thumbnail for each shot into `~/fframestudio/projects/<id>`.
4. **Guard.** Run `node tools/check-distinct-pages.mjs`. It must exit 0. A failure means that
   several distinct scenes would show the same page in the editor.
5. **Open the studio the documented way.** Run `npm run bridge`. There is one bridge, and its
   default library is `~/fframestudio`. First read `~/.config/fframestudio/bridge.json`. If its
   `pid` is alive, use that bridge. Do not start another one. Give the user the
   `/open?token=…` link and the project route `#/p/<id>`.
6. **Leave it reviewable.** Do not apply assistant proposals, export or publish for the user.
   The user decides in fframestudio.

## Before you say that a change works

Run `npm run test:doc`. For UI, bridge or importer changes, also drive the app and look at the
screenshots. See `.agents/skills/verify-fframestudio/SKILL.md`.
