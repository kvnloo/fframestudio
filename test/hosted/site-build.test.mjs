import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

test('static builder omits absent examples, versions assets and emits local-only deployment policy', () => {
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'ffs-site-test-'));
  try {
    const site=path.join(work,'site');
    const result=spawnSync('python3',['tools/build_demo_site.py','--out',site,'--examples',path.join(work,'absent')],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(site,'examples/manifest.json'),'utf8')),[]);
    const config=JSON.parse(fs.readFileSync(path.join(site,'vercel.json'),'utf8'));
    assert.equal(config.cleanUrls,true);
    const headers=Object.fromEntries(config.headers[0].headers.map(h=>[h.key.toLowerCase(),h.value]));
    const directives=Object.fromEntries(headers['content-security-policy'].split(';').filter(s=>s.trim()).map(s=>{const [key,...value]=s.trim().split(/\s+/);return [key,value];}));
    assert.deepEqual(directives['connect-src'],["'self'",'blob:','http://127.0.0.1:*','http://localhost:*','ws://127.0.0.1:*','ws://localhost:*']);
    for(const kind of ['media-src','worker-src'])assert.deepEqual(directives[kind],["'self'",'blob:','data:']);
    assert.equal(headers['referrer-policy'],'no-referrer');
    assert.equal(headers['x-content-type-options'],'nosniff');
    assert.equal(headers['cache-control'],'public, max-age=0, must-revalidate');
    assert.equal(headers['x-frame-options'],'DENY');
    const immutable=config.headers.slice(1);
    assert.equal(immutable.length,2);
    assert.ok(immutable.every(h=>h.headers.some(x=>x.key==='Cache-Control'&&x.value==='public, max-age=31536000, immutable')));
    const version=fs.readdirSync(path.join(site,'app')).find(n=>/^assets-v[0-9a-f]{12}$/.test(n));
    assert.ok(version);
    assert.ok(fs.existsSync(path.join(site,'app',version,'fonts')));
    assert.ok(fs.existsSync(path.join(site,'app',version,'dist/acp-client.js')));
  } finally {fs.rmSync(work,{recursive:true,force:true});}
});
