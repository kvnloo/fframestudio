#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { staticSite } from '../test/static-site.mjs';
import { verifyStyleComponents } from '../test/style-components-journey.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const work=fs.mkdtempSync(path.join(os.tmpdir(),'style-hosted-'));
const out=path.resolve(process.env.FFS_EVIDENCE ?? path.join(root,'verify-out/style-components'));
fs.mkdirSync(out,{recursive:true});
let server,browser;
try {
  const result=spawnSync('python3',['tools/build_demo_site.py','--out',path.join(work,'site'),'--examples',path.join(work,'absent')],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  server=await staticSite(path.join(work,'site'));
  browser=await chromium.launch({executablePath:process.env.CHROMIUM || '/usr/bin/chromium'});
  const context=await browser.newContext({viewport:{width:1896,height:880}});
  const report=await verifyStyleComponents({context,base:server.base,out,root,assert:(ok,message)=>assert.ok(ok,message),mode:'hosted',perf:true});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,samples:report.cliMatchedSamples,metrics:report.metrics,layouts:report.layouts}));
} finally {await browser?.close();await server?.close();fs.rmSync(work,{recursive:true,force:true});}
