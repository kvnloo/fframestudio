// The model behind `e2e explore`. It needs image input AND tool calls AND JSON-schema output.
// Default: google/gemma-4-31b-it on NVIDIA NIM (free key at build.nvidia.com). It passed an image + tool + json_schema
// probe on 2026-11-06; nvidia/nemotron-3.5-super-vl returned empty plans, so explore runs ended "cut short".
// Any OpenAI-compatible endpoint works: E2E_BASE_URL, E2E_MODEL, E2E_KEY_ENV (name of the env var holding the key).
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const provider = createOpenAICompatible({
  name: 'agent',
  baseURL: process.env.E2E_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env[process.env.E2E_KEY_ENV ?? 'NVIDIA_API_KEY'] ?? 'none',
  supportsStructuredOutputs: true,
});

export const agents = {
  default: {
    model: provider.chatModel(process.env.E2E_MODEL ?? 'google/gemma-4-31b-it'),
    system:
      'You are a traffic engineer trying AI Transportation Tools for the first time, and a careful QA tester. ' +
      'Report functional defects as issues and visual or copy problems as warnings. Every finding needs evidence you saw.',
  },
};
