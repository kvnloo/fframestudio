# fframestudio

I built fframestudio on top of [fframes](https://github.com/dmtrKovalenko/fframes) because I love
how powerful the library is. What I still wanted was to choose between designs visually and to
work in something that feels like a film studio.

## Run it

    npm install
    npm run build:acp
    python3 tools/import_projects.py
    npm run bridge

Open the link that `npm run bridge` prints.

## Projects

Each existing film listed in `projects/sources.json` is imported into `~/fframestudio/projects`.
The import only reads the original files. Your edits are saved in the studio's copy of the project.

## Assistant

The assistant works with Claude Code, Codex, Gemini CLI, Hermes or OpenCode through the
[Agent Client Protocol](https://agentclientprotocol.com). Each agent runs on your machine with its own
login, so you use the subscription you already have and no API key goes through the studio.
To add an agent or change one, edit `~/.config/fframestudio/agents.json`.

The bridge only accepts connections from this machine, and it needs the token in that link.
