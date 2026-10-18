import path from 'node:path';
export async function verifyTaste({page,root,out,assert,prefix='taste'}) {
  const fixture=path.join(root,'test/fixtures/taste/synthetic.json');
  const ready=()=>page.waitForFunction(()=>window.ffs?.interactiveAt&&!window.ffs.loading);
  await ready();
  await page.click('[data-action="palette"]');
  await page.locator('#command-search').fill('apply-taste');
  await page.locator('#command-list [data-action="apply-taste"]').click();
  await page.waitForSelector('#taste-file');
  await page.waitForFunction(()=>document.querySelector('#taste-state').dataset.state==='disconnected');
  const before=await page.evaluate(()=>JSON.stringify({...window.ffs.doc,revision:0}));
  await page.locator('#taste-file').setInputFiles(fixture);
  await page.waitForSelector('#taste-on');
  assert(!await page.locator('#taste-on').isChecked(),'Taste opted in silently');
  assert(await page.locator('#taste-state').innerText().then(t=>t.includes('12 evidence items')),'evidence missing');
  assert(await page.locator('[data-taste-signal="soundtrack"]').isDisabled(),'unknown mood invented');
  const dbProfile=await page.evaluate(async()=>{
    const {fileAdapter}=await import('/app/src/taste/adapters.js');return (await fileAdapter().getProfile()).profile;
  });
  assert(dbProfile.revision==='synthetic-film-study-1','profile not in IndexedDB');
  // Reload before editing: profile survives, opt-in does not become a hidden default.
  await page.reload();await ready();await page.click('#tab-taste');await page.waitForSelector('#taste-on');
  assert(!await page.locator('#taste-on').isChecked(),'reload silently enabled Taste');
  await page.locator('#taste-on').check();
  await page.waitForSelector('[data-taste-diff="pacing"]');
  const diff=await page.locator('#taste-diff').innerText();
  assert(diff.includes('confidence')&&diff.includes('→'),'explained diff missing');
  assert(await page.evaluate(()=>JSON.stringify({...window.ffs.doc,revision:0}))===before,'preview mutated project');
  await page.locator('[data-taste-signal="pacing"]').uncheck();
  assert(await page.locator('[data-taste-diff="pacing"]').count()===0,'signal toggle ignored');
  await page.locator('[data-taste-signal="pacing"]').check();
  for(const [width,height] of [[1896,880],[390,780]]) {
    await page.setViewportSize({width,height});
    await page.locator('.taste-controls').evaluate(n => n.scrollIntoView({block:'start'}));
    await page.screenshot({path:path.join(out,`${prefix}-inspector-${width}x${height}.png`)});
    await page.locator('#taste-studies').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,`${prefix}-comparison-${width}x${height}.png`)});
    await page.locator('#taste-diff').evaluate(n => n.scrollIntoView({block:'start'}));
    await page.screenshot({path:path.join(out,`${prefix}-diff-${width}x${height}.png`)});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Taste horizontal overflow');
  }
  await page.setViewportSize({width:1896,height:880});
  await page.click('#taste-apply');
  await page.waitForFunction(()=>window.ffs.doc.metadata.tasteApplications?.length>0);
  const receipt=await page.evaluate(()=>window.ffs.doc.metadata.tasteApplications.at(-1));
  assert(receipt.profileRevision==='synthetic-film-study-1'&&receipt.scope==='task'&&receipt.intensity===65,'wrong receipt');
  assert(receipt.changedSignals.includes('pacing'),'receipt omitted changed pacing');
  const appearance = await page.locator('#preview-text').evaluate(n => ({ colour:n.style.color, font:getComputedStyle(n).fontFamily }));
  assert(appearance.font.includes('Instrument Serif'),'applied typography not rendered in editorial preview');
  assert(appearance.colour.length>0,'applied palette not rendered');
  await page.click('[data-action="save"]');await page.waitForFunction(()=>!window.ffs.saving&&!window.ffs.dirty);
  // Read exact persisted project through the same host boundary (bridge or IndexedDB).
  const persisted=await page.evaluate(async()=>{
    const {request}=await import('/app/src/host.js');return JSON.parse((await request('/fs?path='+encodeURIComponent(window.ffs.path())).then(r=>r.json())).content);
  });
  assert(persisted.metadata.tasteApplications.at(-1).profileRevision===receipt.profileRevision,'receipt not saved to project');
  await page.click('[data-action="undo"]');
  assert(await page.evaluate(()=>JSON.stringify({...window.ffs.doc,revision:0}))===before,'Undo did not restore original');
  await page.click('[data-action="save"]');await page.waitForFunction(()=>!window.ffs.saving&&!window.ffs.dirty);
  await page.click('#taste-delete');await page.waitForFunction(()=>document.querySelector('#taste-state').dataset.state==='disconnected');
  assert(await page.locator('#taste-studies').count()===0,'Delete retained cached preview');
  await page.reload();await ready();await page.click('#tab-taste');await page.waitForSelector('#taste-state[data-state="disconnected"]');
  assert(await page.evaluate(async()=>{
    const {fileAdapter}=await import('/app/src/taste/adapters.js');return (await fileAdapter().getProfile()).state;
  })==='disconnected','deleted profile reappeared');
  // Selecting a curated social reference file never uploads by itself.
  let networkImports = 0;
  const onRequest = request => { if (request.url().includes('/taste/import/collection')) networkImports++; };
  page.on('request', onRequest);
  await page.locator('#taste-source').selectOption('agentweb');
  await page.waitForSelector('#taste-social-file');
  await page.locator('#taste-social-file').setInputFiles(path.join(root, 'test/fixtures/taste/social-pinterest.json'));
  await page.waitForFunction(() => document.querySelector('#taste-social-preview')?.textContent.includes('1 selected pinterest'));
  assert(await page.locator('#taste-social-submit').isDisabled(), 'upload enabled without consent');
  assert(networkImports === 0, 'import sent without approval');
  await page.locator('#taste-social-consent').check();
  assert(await page.locator('#taste-social-submit').isEnabled(), 'approved import unavailable');
  assert(networkImports === 0, 'checkbox alone sent an import');
  await page.locator('#taste-source').selectOption('file');
  assert(await page.locator('#taste-social-file').count() === 0, 'social selection remained after disconnect');
  page.off('request', onRequest);
  return {socialConsentGate:true,imported:true,profilePersisted:true,optIn:true,diff:true,previewPure:true,receiptPersisted:true,undo:true,deleted:true,reloadDeleted:true,viewports:[[1896,880],[390,780]]};
}
