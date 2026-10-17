# Theme fixtures

Omarchy alacritty.toml and light.mode files are from https://github.com/basecamp/omarchy/tree/v3.0.0/themes (Tokyo Night and Catppuccin Latte). Tests create the documented current/theme symlink in a disposable home. Other palettes are synthetic format fixtures, never user config copies.

GNOME is injected as a bounded command result in Node tests; it is never read from the host in fixture tests. Empty and garbled homes must safely return no palette.
