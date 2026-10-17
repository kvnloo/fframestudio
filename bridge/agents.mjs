// Agents the bridge can launch. Each speaks ACP (JSON-RPC 2.0, newline-delimited) on stdio and
// uses whatever login its own CLI already has, so the studio never sees an API key.
// `check` is a binary that must be on PATH; `probe` (optional) must exit 0; `login` explains which subscription it uses.
export const AGENTS = [
  { id: 'claude', name: 'Claude Code', login: 'Claude subscription (claude.ai) or Anthropic key, via the claude CLI login',
    check: 'claude', cmd: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@0.93.0'] },
  { id: 'codex', name: 'Codex', login: 'ChatGPT subscription or OpenAI key, via `codex login`',
    check: 'codex', cmd: 'npx', args: ['-y', '@agentclientprotocol/codex-acp@2.2.2'] },
  { id: 'gemini', name: 'Gemini CLI', login: 'Google account or Gemini key, via the gemini CLI login',
    check: 'gemini', probe: ['gemini', '--version'], cmd: 'gemini', args: ['--acp'] },
  { id: 'hermes', name: 'Hermes Agent', login: 'Whatever provider Hermes is configured with',
    check: 'hermes', cmd: 'hermes', args: ['acp'] },
  { id: 'opencode', name: 'OpenCode', login: 'OpenCode provider config',
    check: 'opencode', probe: ['opencode', '--version'], cmd: 'opencode', args: ['acp'] },
];
