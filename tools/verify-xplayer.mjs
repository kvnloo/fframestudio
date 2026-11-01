#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {staticSite} from '../test/static-site.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const out=path.resolve(process.env.FFS_EVIDENCE||'verify-out/xplayer');
fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],notVerified:['Real X card render','Physical 120 Hz phone']};
let browser,server;
try {
  const build=spawnSync('python3',['tools/build_demo_site.py'],{cwd:root,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  server=await staticSite(path.join(root,'site'));
  const embedHeaders=[];
  for(const url of ['/launch/embed','/launch/embed.html','/launch/embed/']){
    const response=await fetch(server.base+url);
    const csp=response.headers.get('content-security-policy');
    assert.match(csp,/frame-ancestors 'self' https:\/\/x.com/);
    assert.match(csp,/script-src 'self';/);assert.match(csp,/media-src 'self';/);
    assert.equal(response.headers.get('x-frame-options'),null);
    embedHeaders.push({url,status:response.status,csp,xFrameOptions:null});
  }
  // Every other emitted static file, plus near-miss/missing paths, keeps DENY.
  const files=fs.readdirSync(path.join(root,'site'),{recursive:true}).filter(p=>fs.statSync(path.join(root,'site',p)).isFile()).map(p=>'/'+p);
  for(const url of [...files.filter(p=>p!=='/launch/embed.html'),'/','/launch','/launch/embed-not','/launch/embed/foo','/launch/embed.html/no','/missing']){
    const response=await fetch(server.base+url,{method:'HEAD'});
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/,url);
    assert.equal(response.headers.get('x-frame-options'),'DENY',url);
  }
  report.checks.push({name:'route policies',embedHeaders,protectedFiles:files.length-1});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext();const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  report.expectedFrameBlocks=[];
  page.on('console',message=>{
    if(message.type()!=='error')return;
    if(/frame-ancestors/.test(message.text()))report.expectedFrameBlocks.push(message.text());
    else if(!/favicon/.test(message.location().url))report.errors.push(message.text());
  });
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.goto(server.base+'/launch');
  const meta=await page.locator('meta[name^="twitter:"],meta[property^="og:"]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.name||n.getAttribute('property'),n.content])));
  assert.equal(meta['twitter:card'],'player');
  assert.equal(meta['twitter:player'],'https://fframestudio.vercel.app/launch/embed');
  assert.equal(meta['twitter:player:width'],'640');assert.equal(meta['twitter:player:height'],'360');
  for(const key of ['twitter:title','twitter:description','twitter:image','og:title','og:description','og:image','og:url','og:type'])assert.ok(meta[key],key);
  for(const key of ['twitter:image','og:image'])assert.match(meta[key],/^https:\/\/fframestudio.vercel.app\/launch\/media\/poster\.[a-f0-9]{12}\.jpg$/);
  await page.waitForSelector('#film source',{state:'attached'});
  assert.equal(await page.locator('#film').evaluate(v=>v.paused&&!v.autoplay&&v.muted&&v.playsInline),true);
  assert.equal(await page.locator('#fps').isVisible(),false);
  await page.waitForFunction(()=>document.querySelector('#film').readyState>=1);
  assert.match(await page.locator('#status').innerText(),/Tap play to watch/);
  report.prePlayMediaRequests=requests.filter(u=>u.endsWith('.mp4')).length; // preload=none is advisory.
  for(const viewport of [{width:412,height:915},{width:1440,height:900}]){
    await page.setViewportSize(viewport);await page.locator('#film').evaluate(v=>v.poster&&new Promise((resolve,reject)=>{const i=new Image();i.onload=resolve;i.onerror=reject;i.src=v.poster;}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(out,`launch-${viewport.width}x${viewport.height}.png`),fullPage:true});
  }
  report.checks.push({name:'share metadata and tap-to-play',meta});
  const manifest=await fetch(server.base+'/launch/variants.json').then(r=>r.json());
  report.buildId=manifest.buildId;
  assert.equal(await page.locator('meta[name="ffs-launch-build"]').getAttribute('content'),manifest.buildId);
  assert.deepEqual(manifest.variants.map(v=>[v.fps,v.codec]),[[120,'hvc1'],[120,'avc1.640033'],[60,'avc1.64002A']]);
  report.media=[];
  for(const v of manifest.variants){
    const file=path.join(root,'site',v.url);assert.equal(fs.statSync(file).size,v.bytes);
    const probe=spawnSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,codec_tag_string,width,height,r_frame_rate,nb_read_frames,level','-of','json',file],{encoding:'utf8'});
    assert.equal(probe.status,0);const stream=JSON.parse(probe.stdout).streams[0];
    assert.equal(stream.r_frame_rate,`${v.fps}/1`);assert.equal(stream.width,1920);assert.equal(stream.height,1080);
    report.media.push({...v,...stream});
    const range=await fetch(server.base+v.url,{headers:{Range:'bytes=0-31'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32);
  }
  // Translate a virtual HTTPS player origin to the static server, preserving response headers/bytes.
  // This avoids mixed-content / local-network permission blocking in a fake public X parent.
  await page.route('https://player.test/**',async route=>{
    const url=new URL(route.request().url());
    const response=await fetch(server.base+url.pathname+url.search);
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  report.frameTransport='Virtual HTTPS origin mirrors CSP-serving static server bytes and headers; fake parents only.';
  for(const [parent,allowed]of [['https://x.com',true],['https://twitter.com',true],['https://sub.x.com',true],['https://evil.test',false]]){
    await page.route(parent+'/**',route=>route.fulfill({contentType:'text/html',body:`<iframe src="https://player.test/launch/embed" width="640" height="360" allow="autoplay; fullscreen"></iframe>`}));
    await page.goto(parent+'/xplayer-test');await page.waitForTimeout(500);
    const rendered=await Promise.all(page.frames().filter(f=>f!==page.mainFrame()).map(f=>f.locator('#film').count().catch(()=>0))).then(c=>c.some(Boolean));
    assert.equal(rendered,allowed,parent);report.checks.push({name:'frame-ancestors',parent,rendered});
  }
  await page.goto(server.base+'/launch/embed?debug=1');await page.waitForSelector('#film source',{state:'attached'});
  await page.locator('#film').evaluate(v=>v.play());
  await page.waitForFunction(()=>document.querySelector('#fps').dataset.fps,{timeout:15000});
  const samples=[];for(let i=0;i<3;i++){samples.push(Number(await page.locator('#fps').getAttribute('data-fps')));await page.waitForTimeout(750);}
  const playback=await page.locator('#film').evaluate(v=>({src:v.currentSrc,width:v.videoWidth,height:v.videoHeight,time:v.currentTime,quality:v.getVideoPlaybackQuality().toJSON?.()||{totalVideoFrames:v.getVideoPlaybackQuality().totalVideoFrames,droppedVideoFrames:v.getVideoPlaybackQuality().droppedVideoFrames}}));
  await page.screenshot({path:path.join(out,'embed-debug.png')});
  report.checks.push({name:'rVFC playback observation',samples,over100:samples.some(n=>n>100),playback});
  assert.ok(playback.time>0);assert.equal(playback.width,1920);
  await page.click('#sound');assert.equal(await page.locator('#film').evaluate(v=>v.muted),false);
  assert.deepEqual(report.errors,[]);
  report.ok=true;
} catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
