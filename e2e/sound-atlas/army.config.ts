import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { agents } from './agent.ts';
import { armyBrowser } from './browser.ts';

// The site under test: this checkout's bundle (bundle.sh) served by tools/sound-atlas-serve.mjs with SA_SCHEMA=sa_e2e,
// so community writes never touch production rows. run.sh starts it on 18941. SITE_URL points at a preview or prod instead.
const site = { url: process.env.SITE_URL ?? 'http://127.0.0.1:18941/' };
const desk = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 }; // the owner's phones are ~390 CSS px wide
const target = (name: string, viewport: typeof desk) => ({ name, engine: web({ viewport, connect: armyBrowser(viewport) }), app: site });

export default {
  tests: ['tests/journeys.e2e.ts'],
  agents,
  targets: [target('desktop', desk), target('phone', phone)],
  output: '.e2e/army',
} satisfies E2EConfig;
