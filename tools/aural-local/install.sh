#!/usr/bin/env bash
# One-command setup for Aural's system-wide chain, from the Sound Atlas pane ("This computer" tab):
#
#   curl -fsSL https://glide-music-picker.vercel.app/aural/install.sh | bash
#
# It detects the OS and sets up the chain from kvnloo/.files:
#   Linux (Hyprland or any PipeWire desktop): the PipeWire filter-chain sinks (AutoEQ + BRIR + bs2b + LSP/ZAM),
#     the Topping DX5 WirePlumber rule, audio-evolve / audio-sink on PATH, and aural-local as a systemd user service.
#   macOS: BlackHole 2ch + CamillaDSP (AutoEQ + crossfeed / BRIR room + every experience script), playing to the
#     output you are listening on now, both as LaunchAgents, plus aural-local.
# aural-local is the small server the pane talks to (127.0.0.1:4317, published to your tailnet with
# `tailscale serve` when Tailscale is up). Re-running is safe: it updates in place and keeps backups.
#
# Env: AURAL_DOTFILES (default ~/workspace/.files), AURAL_DOTFILES_REF (default dev), AURAL_SITE (where
# server.mjs and aural.js come from; default the live site), AURAL_YES=1 (no prompts), AURAL_DRY=1 (print only).
# Bash 3.2 compatible (macOS /bin/bash).
set -euo pipefail

SITE="${AURAL_SITE:-https://glide-music-picker.vercel.app}"
DOT="${AURAL_DOTFILES:-$HOME/workspace/.files}"
DOT_REPO="https://github.com/kvnloo/.files.git"
DOT_REF="${AURAL_DOTFILES_REF:-dev}"
APP="$HOME/.local/share/aural-local"
BIN="$HOME/.local/bin"
CDSP_VERSION="v4.1.3"   # configs in .files use CamillaDSP 4 sample-format names (F32, S32)
PYCDSP_VERSION="v4.0.0"
DRY="${AURAL_DRY:-0}"
STAMP="$(date +%Y%m%d-%H%M%S)"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31mxx\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '  + %s\n' "$*"; else "$@"; fi; }
have() { command -v "$1" >/dev/null 2>&1; }

# Put a file in place: a symlink when the target can use the dotfiles path as written, else a copy with the
# author's absolute dotfiles path rewritten to this checkout. Any real file already there is kept as .bak-aural-*.
place() { # place <src> <dst> [copy]
  local src="$1" dst="$2" mode="${3:-auto}"
  run mkdir -p "$(dirname "$dst")"
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then run mv "$dst" "$dst.bak-aural-$STAMP"; warn "kept your old $(basename "$dst") as $(basename "$dst").bak-aural-$STAMP"; fi
  if [ "$mode" = auto ] && { [ "$DOT" = "/home/kvn/workspace/.files" ] || ! grep -q '/home/kvn/workspace/.files' "$src" 2>/dev/null; }; then
    run ln -sfn "$src" "$dst"
  else
    run rm -f "$dst"
    if [ "$DRY" = 1 ]; then printf '  + sed (dotfiles path -> %s) %s > %s\n' "$DOT" "$src" "$dst"; else sed "s|/home/kvn/workspace/.files|$DOT|g" "$src" > "$dst"; [ -x "$src" ] && chmod +x "$dst"; fi
  fi
  ok "$dst"
}

fetch_dotfiles() {
  say "Dotfiles: $DOT"
  if [ -d "$DOT/.git" ]; then
    ok "using your checkout ($(git -C "$DOT" rev-parse --abbrev-ref HEAD 2>/dev/null) @ $(git -C "$DOT" rev-parse --short HEAD 2>/dev/null)); left as is"
  elif [ -e "$DOT" ]; then
    die "$DOT exists but is not a git checkout; set AURAL_DOTFILES to your .files checkout"
  else
    # Only the audio parts: a sparse, blobless clone of kvnloo/.files.
    run mkdir -p "$(dirname "$DOT")"
    run git clone --filter=blob:none --sparse --branch "$DOT_REF" "$DOT_REPO" "$DOT"
    run git -C "$DOT" sparse-checkout set config/pipewire config/wireplumber config/camilladsp config/autoeq config/brir scripts
    ok "cloned $DOT_REPO ($DOT_REF), audio paths only"
  fi
}

fetch_server() {
  say "aural-local server -> $APP"
  run mkdir -p "$APP/tools/aural-local" "$APP/web/src/music-atlas"
  # server.mjs imports ../../web/src/music-atlas/aural.js (the soundscape list), so keep that layout.
  run curl -fsSL "$SITE/aural/server.mjs" -o "$APP/tools/aural-local/server.mjs"
  run curl -fsSL "$SITE/src/music-atlas/aural.js" -o "$APP/web/src/music-atlas/aural.js"
  ok "server.mjs + aural.js from $SITE"
}

# --------------------------------------------------------------------------------------------- Linux
linux_packages() {
  say "Packages"
  local pkgs
  if have pacman; then
    pkgs="pipewire pipewire-pulse wireplumber lsp-plugins-lv2 zam-plugins-lv2 ladspa-bs2b cava nodejs git jq python"
    local missing="" repo="" aur="" p
    for p in $pkgs; do pacman -Qq "$p" >/dev/null 2>&1 || missing="$missing $p"; done
    if [ -z "$missing" ]; then ok "all present"; return; fi
    run sudo pacman -Sy >/dev/null
    for p in $missing; do if pacman -Si "$p" >/dev/null 2>&1; then repo="$repo $p"; else aur="$aur $p"; fi; done
    [ -z "$repo" ] || run sudo pacman -S --needed --noconfirm $repo
    if [ -n "$aur" ]; then # e.g. ladspa-bs2b is in CachyOS's repos but only the AUR on plain Arch
      local helper="" h; for h in paru yay; do have $h && helper=$h && break; done
      if [ -n "$helper" ]; then run "$helper" -S --needed --noconfirm $aur
      else
        run sudo pacman -S --needed --noconfirm base-devel git
        for p in $aur; do
          local b; b="$(mktemp -d)"
          run git clone -q "https://aur.archlinux.org/$p.git" "$b/$p"
          (cd "$b/$p" && run makepkg -si --noconfirm --needed) || die "could not build $p from the AUR"
          rm -rf "$b"
        done
      fi
    fi
  elif have apt-get; then
    pkgs="pipewire pipewire-pulse wireplumber lsp-plugins-lv2 zam-plugins bs2b-ladspa cava nodejs git jq python3"
    run sudo apt-get update -qq && run sudo apt-get install -y $pkgs
  elif have dnf; then
    pkgs="pipewire pipewire-pulseaudio wireplumber lsp-plugins-lv2 zam-plugins ladspa-bs2b-plugins cava nodejs git jq python3"
    run sudo dnf install -y $pkgs
  else
    warn "unknown package manager: install PipeWire, WirePlumber, LSP + ZAM LV2 plugins, the bs2b LADSPA plugin, cava, Node.js, git and jq yourself"
  fi
  ok "packages ready"
}

linux_setup() {
  local hypr=""; { [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ] || have hyprctl; } && hypr=1
  say "Linux${hypr:+ · Hyprland} · PipeWire chain from .files"
  have git || die "git is required"
  [ "$DRY" = 1 ] || linux_packages
  fetch_dotfiles
  local cfg="${XDG_CONFIG_HOME:-$HOME/.config}"
  say "PipeWire filter-chain sinks (Clean, Crossfeed, Room, Movie, Aural Evolution)"
  place "$DOT/config/pipewire/pipewire.conf.d/10-headphone-dsp.conf"   "$cfg/pipewire/pipewire.conf.d/10-headphone-dsp.conf"
  place "$DOT/config/pipewire/pipewire.conf.d/11-aural-evolution.conf" "$cfg/pipewire/pipewire.conf.d/11-aural-evolution.conf"
  say "Per-app routing (Plex and Google Chrome -> Movie sink)"
  place "$DOT/config/pipewire/pipewire-pulse.conf.d/20-browser-bypass-brir.conf" "$cfg/pipewire/pipewire-pulse.conf.d/20-browser-bypass-brir.conf"
  place "$DOT/config/pipewire/pipewire-pulse.conf.d/30-plex-movie-dsp.conf"      "$cfg/pipewire/pipewire-pulse.conf.d/30-plex-movie-dsp.conf"
  say "WirePlumber: Topping DX5 bit-perfect rule"
  place "$DOT/config/wireplumber/wireplumber.conf.d/51-topping-dx5.conf" "$cfg/wireplumber/wireplumber.conf.d/51-topping-dx5.conf"
  say "Commands on PATH ($BIN)"
  local s
  for s in audio-evolve audio-evolve-validate audio-sink; do [ -f "$DOT/scripts/$s" ] && place "$DOT/scripts/$s" "$BIN/$s"; done
  place "$DOT/config/pipewire/headphone-switch.sh" "$BIN/headphone-switch"
  fetch_server
  say "Services"
  local node; node="$(command -v node || true)"; [ -n "$node" ] || [ "$DRY" = 1 ] || die "node not found after install"
  local unit="$cfg/systemd/user/aural-local.service"
  if [ "$DRY" = 1 ]; then printf '  + write %s\n' "$unit"; else mkdir -p "$(dirname "$unit")"; cat > "$unit" <<EOF
[Unit]
Description=aural-local: Sound Atlas's bridge to the PipeWire DSP chain (127.0.0.1:4317)
After=pipewire.service wireplumber.service pipewire-pulse.service
Wants=pipewire.service wireplumber.service pipewire-pulse.service

[Service]
Environment=AURAL_DOTFILES=$DOT
Environment=PATH=$BIN:/usr/local/bin:/usr/bin:/bin
ExecStart=$node $APP/tools/aural-local/server.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
  fi
  ok "$unit"
  run systemctl --user daemon-reload
  run systemctl --user restart pipewire.service wireplumber.service pipewire-pulse.service
  sleep 2
  run systemctl --user enable aural-local.service
  run systemctl --user restart aural-local.service
  ok "pipewire + wireplumber restarted; aural-local enabled"
  [ "$DRY" = 1 ] || verify_linux
  [ -n "$hypr" ] && have hyprctl && [ "$DRY" != 1 ] && hyprctl notify 1 5000 0 "Aural chain installed · open Sound Atlas → Aural → This computer" >/dev/null 2>&1 || true
}

verify_linux() {
  say "Check"
  local n s
  n=$(pactl list short sinks 2>/dev/null | grep -c -E 'effect_input\.(headphone_dsp|aural_evolution)' || true)
  [ "$n" -gt 0 ] && ok "$n DSP sinks loaded" || warn "no DSP sinks yet: check \`journalctl --user -u pipewire -n 50\` (missing LV2/LADSPA plugin?)"
  for s in 1 2 3 4 5; do curl -fsS -m 2 http://127.0.0.1:4317/health >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS -m 2 http://127.0.0.1:4317/health >/dev/null 2>&1 && ok "aural-local answering on 127.0.0.1:4317" || warn "aural-local not answering: \`journalctl --user -u aural-local -n 50\`"
}

# --------------------------------------------------------------------------------------------- macOS
mac_setup() {
  say "macOS · CamillaDSP + BlackHole chain from .files"
  local arch; arch="$(uname -m)"
  if ! have brew; then
    say "Homebrew (asks for your password once)"
    run /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty # piped from curl: prompts read the terminal
    [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"
  fi
  have brew || [ "$DRY" = 1 ] || die "Homebrew is required"
  say "Packages"
  run brew install node switchaudio-osx cava python git
  if ! brew list --cask blackhole-2ch >/dev/null 2>&1; then run brew install --cask blackhole-2ch; fi
  ok "node, SwitchAudioSource, cava, python, BlackHole 2ch"

  # The output you hear right now is where CamillaDSP will play (BlackHole becomes the system output).
  local state="$HOME/.config/aural"; run mkdir -p "$state"
  local out; out="$(SwitchAudioSource -c -t output 2>/dev/null || true)"
  if [ -z "$out" ] || [ "$out" = "BlackHole 2ch" ]; then out="$(cat "$state/playback-device" 2>/dev/null || true)"; fi
  [ -n "$out" ] || [ "$DRY" = 1 ] || die "couldn't tell which output you listen on; pick your headphones as the output, then run this again"
  [ "$DRY" = 1 ] || printf '%s\n' "$out" > "$state/playback-device"
  ok "playback device: ${out:-?}"

  say "CamillaDSP $CDSP_VERSION -> $BIN/camilladsp"
  local asset="camilladsp-macos-aarch64.tar.gz"; [ "$arch" = x86_64 ] && asset="camilladsp-macos-amd64.tar.gz"
  if ! { have camilladsp && camilladsp --version 2>/dev/null | grep -q "${CDSP_VERSION#v}"; }; then
    run mkdir -p "$BIN"
    if [ "$DRY" = 1 ]; then printf '  + curl %s | tar -x -C %s\n' "https://github.com/HEnquist/camilladsp/releases/download/$CDSP_VERSION/$asset" "$BIN"
    else curl -fsSL "https://github.com/HEnquist/camilladsp/releases/download/$CDSP_VERSION/$asset" | tar -xz -C "$BIN"; chmod +x "$BIN/camilladsp"; xattr -d com.apple.quarantine "$BIN/camilladsp" 2>/dev/null || true; fi
  fi
  ok "$("$BIN/camilladsp" --version 2>/dev/null || echo camilladsp)"

  fetch_dotfiles
  # A real copy in ~/.config/camilladsp: the scripts keep state, a venv and generated configs next to themselves,
  # and the playback device is this Mac's, so the dotfiles checkout stays clean.
  local C="$HOME/.config/camilladsp"
  say "CamillaDSP profiles -> $C"
  run mkdir -p "$C" "$HOME/.config/autoeq" "$HOME/.local/share/camilladsp"
  run rsync -a --exclude venv --exclude .state --exclude configs --exclude '*.plist' "$DOT/config/camilladsp/" "$C/"
  run rsync -a "$DOT/config/autoeq/" "$HOME/.config/autoeq/"
  if [ "$DRY" != 1 ]; then
    local f
    for f in "$C"/camilladsp*.yml; do
      # playback device -> this Mac's output; keep exclusive + S32 only for the DAC the profiles were written for
      awk -v dev="$out" '
        /^  playback:/ { pb = 1; print; next }
        pb && /^  [a-z]/ { pb = 0 }
        pb && /^    device:/ { print "    device: \"" dev "\""; next }
        pb && dev != "Moonriver 2" && (/^    exclusive:/ || /^    format:/) { next }
        { print }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    done
    (cd "$C" && bash ./generate-rate-configs.sh >/dev/null)
    printf 'CURRENT_PROFILE="clean"\nCURRENT_RATE="48000"\n' > "$C/.state"
  fi
  ok "clean · crossfeed · room at 44.1–384 kHz, playing to \"${out:-?}\""
  say "Python helper for live profile switching (pycamilladsp $PYCDSP_VERSION)"
  run python3 -m venv "$C/venv"
  run "$C/venv/bin/pip" install -q --upgrade pip "git+https://github.com/HEnquist/pycamilladsp.git@$PYCDSP_VERSION"
  ok "$C/venv"

  fetch_server
  say "LaunchAgents"
  local LA="$HOME/Library/LaunchAgents" node; node="$(command -v node || echo /opt/homebrew/bin/node)"
  run mkdir -p "$LA"
  write_plist "$LA/com.camilladsp.daemon.plist" com.camilladsp.daemon "$C" \
    "$BIN/camilladsp" -p 1234 -a 127.0.0.1 -l info -o "$HOME/.local/share/camilladsp/camilladsp.log" -s "$HOME/.local/share/camilladsp/statefile.yml" "$C/configs/camilladsp-48000.yml"
  write_plist "$LA/com.kvnloo.aural-local.plist" com.kvnloo.aural-local "$APP" "$node" "$APP/tools/aural-local/server.mjs"
  local uid L; uid="$(id -u)"
  for L in com.camilladsp.daemon com.kvnloo.aural-local; do
    run launchctl bootout "gui/$uid/$L" 2>/dev/null || true
    run launchctl bootstrap "gui/$uid" "$LA/$L.plist"
  done
  ok "camilladsp + aural-local start now and at login"
  say "System output -> BlackHole 2ch (CamillaDSP plays it to \"${out:-?}\")"
  run SwitchAudioSource -t output -s "BlackHole 2ch" >/dev/null
  ok "done"
  [ "$DRY" = 1 ] || verify_mac
  cat <<EOF

  First run only: macOS treats CamillaDSP reading BlackHole as recording. If you hear silence, open
  System Settings → Privacy & Security → Microphone and allow camilladsp (or run \`tccutil reset Microphone\`
  and start it once from Terminal: $BIN/camilladsp $C/configs/camilladsp-48000.yml).
  To undo: SwitchAudioSource -t output -s "$out"; launchctl bootout gui/$uid/com.camilladsp.daemon
EOF
}

write_plist() { # write_plist <path> <label> <workdir> <program> [args...]
  local path="$1" label="$2" wd="$3"; shift 3
  if [ "$DRY" = 1 ]; then printf '  + write %s\n' "$path"; return; fi
  {
    printf '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n'
    printf '  <key>Label</key><string>%s</string>\n  <key>ProgramArguments</key><array>\n' "$label"
    local a; for a in "$@"; do printf '    <string>%s</string>\n' "$a"; done
    printf '  </array>\n  <key>EnvironmentVariables</key><dict>\n'
    printf '    <key>PATH</key><string>%s:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>\n' "$BIN"
    printf '    <key>AURAL_DOTFILES</key><string>%s</string>\n    <key>AURAL_CAMILLA</key><string>%s</string>\n' "$DOT" "$HOME/.config/camilladsp"
    printf '  </dict>\n  <key>WorkingDirectory</key><string>%s</string>\n' "$wd"
    printf '  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ProcessType</key><string>Interactive</string>\n'
    printf '  <key>StandardOutPath</key><string>%s/.local/share/camilladsp/%s.out.log</string>\n' "$HOME" "$label"
    printf '  <key>StandardErrorPath</key><string>%s/.local/share/camilladsp/%s.err.log</string>\n</dict></plist>\n' "$HOME" "$label"
  } > "$path"
  ok "$path"
}

verify_mac() {
  say "Check"
  local s
  for s in 1 2 3 4 5 6; do nc -z 127.0.0.1 1234 2>/dev/null && break; sleep 1; done
  nc -z 127.0.0.1 1234 2>/dev/null && ok "CamillaDSP running (websocket :1234)" || warn "CamillaDSP not running: tail ~/.local/share/camilladsp/camilladsp.log"
  for s in 1 2 3 4 5; do curl -fsS -m 2 http://127.0.0.1:4317/health >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS -m 2 http://127.0.0.1:4317/health >/dev/null 2>&1 && ok "aural-local answering on 127.0.0.1:4317" || warn "aural-local not answering: tail ~/.local/share/camilladsp/com.kvnloo.aural-local.err.log"
}

# ---------------------------------------------------------------------------------------------- main
case "$(uname -s)" in
  Linux)  linux_setup ;;
  Darwin) mac_setup ;;
  *) die "unsupported OS: $(uname -s) (Linux with PipeWire, or macOS)" ;;
esac
cat <<EOF

Aural is set up. Open Sound Atlas, type "aural" (or long-press the logo) → This computer.
  $SITE/#aural
Phones on your tailnet: the pane shows a QR once aural-local is published with \`tailscale serve\`
(if it says it can't, run once: sudo tailscale set --operator=\$USER).
EOF
