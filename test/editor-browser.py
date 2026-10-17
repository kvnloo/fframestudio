"""Run against an owned bridge via tools/verify-editor.mjs. No production library writes."""
import asyncio, json, os, pathlib
from playwright.async_api import async_playwright
async def main():
    out=pathlib.Path(os.environ['FFS_EVIDENCE']);out.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=await b.new_page(viewport={'width':1440,'height':1000})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto(os.environ['FFS_URL']);await page.locator('a[href="#/p/omarchy-themes"]').click()
        await page.locator('[data-select="s01"]').first.click()
        await page.locator('#duration').fill('150');await page.locator('#duration').press('Tab')
        await page.wait_for_function('window.ffs.doc.videos[0].clips[0].duration===150')
        await page.locator('[data-field="title"]').fill('A clearer opening');await page.locator('[data-field="title"]').press('Tab')
        await page.wait_for_function('window.ffs.doc.videos[0].clips[0].textOverrides.title==="A clearer opening"')
        await page.locator('[data-action=\"undo\"]:visible').click();await page.wait_for_function('!window.ffs.doc.videos[0].clips[0].textOverrides.title')
        await page.locator('[data-action=\"redo\"]:visible').click();await page.wait_for_function('window.ffs.doc.videos[0].clips[0].textOverrides.title==="A clearer opening"')
        await page.evaluate('window.ffs.seek(60)');await page.locator('[data-action=\"split\"]:visible').first.click()
        await page.wait_for_function('window.ffs.doc.videos[0].clips.length===14')
        await page.locator('[data-action=\"save\"]:visible').click();await page.wait_for_function('document.querySelector("#save-status").textContent==="Saved"')
        # Repeated edge drags must use the latest range, not a stale event closure.
        await page.locator('#snap').uncheck()
        for _ in range(2):
            expected=await page.evaluate('window.ffs.doc.videos[0].clips[0].duration+Math.round(12/window.ffs.scale)')
            handle=page.locator('.timeline-clip[data-select="s01"] [data-edge="out"]');await handle.scroll_into_view_if_needed();box=await handle.bounding_box();assert box is not None
            await page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);await page.mouse.down()
            await page.mouse.move(box['x']+box['width']/2+12,box['y']+box['height']/2,steps=3);await page.mouse.up()
            try: await page.wait_for_function('(n)=>window.ffs.doc.videos[0].clips[0].duration===n',arg=expected,timeout=3000)
            except Exception:
                print('Drag failure',expected,await page.evaluate('({scale:window.ffs.scale,duration:window.ffs.doc.videos[0].clips[0].duration,scope:document.querySelector("#scope").textContent,toast:document.querySelector("#toast").textContent})'))
                await page.screenshot(path=str(out/'drag-failure.png'),full_page=True);raise
        await page.evaluate('window.ffs.action("undo")');await page.evaluate('window.ffs.action("undo")')
        await page.locator('[data-action=\"save\"]:visible').click();await page.wait_for_function('document.querySelector("#save-status").textContent==="Saved"')
        # A local text edit must leave unrelated mounted cards untouched, not just retain their roots.
        stable=await page.evaluate('''async()=>{const nodes=[...document.querySelectorAll('.story-card')].filter(n=>n.dataset.select!=='s01');let changes=0;const observer=new MutationObserver(rs=>changes+=rs.length);for(const n of nodes)observer.observe(n,{subtree:true,attributes:true,childList:true,characterData:true});await window.ffs.run({type:'edit-text',clipId:'s01',field:'title',value:'Incremental check'});await new Promise(r=>setTimeout(r,0));observer.disconnect();await window.ffs.action('undo');return changes;}''')
        assert stable==0, f'Unrelated cards mutated {stable} times'
        await page.locator('[data-action=\"save\"]:visible').click();await page.wait_for_function('document.querySelector("#save-status").textContent==="Saved"')
        await page.screenshot(path=str(out/'editor-desktop.png'),full_page=True)
        await page.reload();await page.wait_for_function('window.ffs?.doc?.videos[0].clips.length===14')
        assert await page.evaluate('window.ffs.doc.videos[0].clips[0].textOverrides.title')=='A clearer opening'
        await page.keyboard.press('Control+k');await page.locator('#palette').wait_for(state='visible');await page.keyboard.press('Escape')
        await page.locator('#version-name').fill('Baseline');await page.locator('[data-action=\"save-version\"]:visible').click()
        await page.wait_for_function('window.ffs.doc.versions.length===1')
        await page.locator('#duration').fill('50');await page.locator('#duration').press('Tab');await page.wait_for_function('window.ffs.doc.videos[0].clips[0].duration===50')
        await page.locator('#version-name').fill('Shorter');await page.locator('[data-action=\"save-version\"]:visible').click();await page.wait_for_function('window.ffs.doc.versions.length===2')
        await page.locator('[data-action=\"compare\"]:visible').click();await page.wait_for_function('document.querySelector("#version-diff").textContent.includes("duration")')
        await page.locator('[data-action=\"restore-version\"]:visible').click();await page.wait_for_function('window.ffs.doc.videos[0].clips[0].duration===60')
        await page.locator('[data-action=\"save\"]:visible').click();await page.wait_for_function('document.querySelector("#save-status").textContent==="Saved"')
        # An outside writer cannot silently erase a dirty local edit.
        await page.evaluate('window.ffs.run({type:"edit-text",clipId:"s01",field:"title",value:"Local unsaved"})')
        await page.evaluate('''async()=>{const d=structuredClone(window.ffs.doc);d.title='External writer';await fetch('/fs?path='+encodeURIComponent(window.ffs.path()),{method:'PUT',body:JSON.stringify(d)});}''')
        await page.locator('#external').wait_for(state='visible');assert await page.evaluate('window.ffs.doc.title')!='External writer'
        page.once('dialog',lambda d:d.accept());await page.locator('[data-action=\"reload-external\"]:visible').click();await page.wait_for_function('!window.ffs.conflict')
        # All proposal edits remain normal undoable commands; stale revisions fail closed.
        await page.evaluate('window.ffs.receiveProposal({schema:"fframestudio.proposal/1",projectId:window.ffs.doc.id,baseRevision:window.ffs.doc.revision-1,commands:[{type:"delete",clipId:"s01"}]})')
        assert await page.locator('[data-action=\"apply-proposal\"]:visible').is_disabled()
        await page.locator('[data-action=\"reject-proposal\"]:visible').click()
        await page.locator('[data-action=\"settings\"]:visible').click();await page.locator('#theme').select_option('contrast');await page.locator('[data-binding="nextFrame"]').fill('x');await page.locator('[data-binding="nextFrame"]').press('Tab');await page.locator('[data-action=\"close-settings\"]:visible').click()
        frame=await page.evaluate('Math.round(window.ffs.frame)');await page.keyboard.press('x');assert await page.evaluate('Math.round(window.ffs.frame)')==frame+1
        await page.reload();await page.wait_for_function('window.ffs?.doc');assert await page.evaluate('document.documentElement.dataset.theme')=='contrast'
        # Persist all workspace customization, including native CSS resize and collapse.
        await page.locator('[data-action="toggle-story"]:visible').click()
        await page.reload();await page.wait_for_function('window.ffs?.doc');assert await page.locator('.story-panel').evaluate('(n)=>n.classList.contains("collapsed")')
        await page.locator('[data-action="toggle-story"]:visible').click()
        pane=page.locator('.story-panel');box=await pane.bounding_box();assert box is not None
        await page.mouse.move(box['x']+box['width']-3,box['y']+box['height']-3);await page.mouse.down();await page.mouse.move(box['x']+box['width']+37,box['y']+box['height']-3,steps=5);await page.mouse.up()
        await page.wait_for_function('JSON.parse(localStorage.getItem("ffs.settings")).storyWidth>290')
        width=await pane.evaluate('(n)=>n.getBoundingClientRect().width');await page.reload();await page.wait_for_function('window.ffs?.doc');assert abs(await pane.evaluate('(n)=>n.getBoundingClientRect().width')-width)<2
        await page.locator('[data-action="settings"]:visible').click();await page.locator('#theme').select_option('light');assert await page.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()')=='#f1f0e9'
        await page.locator('#theme').select_option('custom');await page.locator('[data-token="acc"]').fill('#123456');await page.locator('[data-action="close-settings"]:visible').click()
        await page.reload();await page.wait_for_function('window.ffs?.doc');assert await page.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--acc").trim()')=='#123456'
        await page.locator('[data-action=\"settings\"]:visible').click();await page.locator('#theme').select_option('dark');await page.locator('[data-action=\"close-settings\"]:visible').click()
        await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(out/'editor-mobile.png'),full_page=True)
        assert await page.evaluate('document.documentElement.scrollWidth<=390'), 'mobile horizontal overflow'
        assert not errors,errors
        (out/'browser.json').write_text(json.dumps({'workflow':'trim/edit/undo/redo/split/save/reload/palette/mobile','errors':errors},indent=2))
        await b.close()
asyncio.run(main())
