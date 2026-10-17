import asyncio,json,os,pathlib
from playwright.async_api import async_playwright
async def main():
 out=pathlib.Path(os.environ['FFS_EVIDENCE']);out.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=await b.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(os.environ['FFS_URL']);await page.locator('a[href="#/p/omarchy-themes"]').click();await page.wait_for_function('window.ffs?.doc')
  await page.locator('[data-agent="hermes"]').click();await page.wait_for_function('document.querySelector("#chat").textContent.includes("ready")',timeout=120000)
  await page.locator('#ask').fill('Propose changing the title field of clip s01 to exactly "Hermes proposal verified". Write the requested proposal JSON file using your file tool. Do not change project.json. No other edits.');await page.locator('#send').click()
  try:
   for attempt in range(60):
    if await page.locator('[data-action="apply-proposal"]').count(): break
    chat=await page.locator('#chat').inner_text()
    if attempt%3==0: print('ACP progress:',chat[-2400:],flush=True)
    perms=page.locator('.perm')
    for i in range(await perms.count()):
     perm=perms.nth(i);text=await perm.inner_text()
     if str(pathlib.Path(os.environ['FFS_ROOT'])/'projects/omarchy-themes/proposals/') in text and any(x in text.lower() for x in ['write','save','edit']):
      allow=perm.get_by_role('button',name='Allow edit',exact=False)
      if await allow.count(): await allow.first.click()
    await page.wait_for_timeout(4000)
   await page.locator('[data-action="apply-proposal"]').wait_for(timeout=1000)
  except Exception:
   (out/'acp-failure.json').write_text(json.dumps({'chat':await page.locator('#chat').inner_text(),'errors':errors},indent=2));await page.screenshot(path=str(out/'acp-failure.png'),full_page=True);raise
  before=await page.evaluate('window.ffs.doc.videos[0].clips[0].textOverrides.title || ""');assert before!='Hermes proposal verified'
  await page.locator('[data-action="inspect-proposal"]').click();await page.evaluate('window.scrollTo(0,0)');await page.screenshot(path=str(out/'acp-proposal-inspect.png'),full_page=True)
  proposal=await page.evaluate('window.ffs.pendingProposal');assert proposal['commands'][0]['type']=='edit-text'
  await page.locator('[data-action="apply-proposal"]').click();await page.wait_for_function('window.ffs.doc.videos[0].clips[0].textOverrides.title==="Hermes proposal verified"')
  await page.locator('[data-action="undo"]').click();await page.wait_for_function('window.ffs.doc.videos[0].clips[0].textOverrides.title!=="Hermes proposal verified"')
  await page.locator('[data-action="redo"]').click();await page.wait_for_function('window.ffs.doc.videos[0].clips[0].textOverrides.title==="Hermes proposal verified"')
  await page.locator('[data-action="save"]').click();await page.wait_for_function('document.querySelector("#save-status").textContent==="Saved"');await page.screenshot(path=str(out/'acp-proposal-applied.png'),full_page=True)
  (out/'acp.json').write_text(json.dumps({'proposal':proposal,'chat':await page.locator('#chat').inner_text(),'errors':errors,'verified':'real Hermes ACP write → inspect → apply → undo → redo → save'},indent=2));assert not errors,errors
  await b.close()
asyncio.run(main())
