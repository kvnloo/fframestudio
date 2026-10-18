// Intake only: no offline interception or network fetching of shared URLs.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const u=new URL(event.request.url);
  if(u.origin!==self.location.origin||u.pathname!=='/share'||event.request.method!=='POST')return;
  event.respondWith((async()=>{
    const form=await event.request.formData(), file=form.get('video');
    if(file && (!(file instanceof File)||!file.type.startsWith('video/')||file.size>60_000_000))return new Response('Share a video file smaller than 60 MB.',{status:400});
    const item={file:file||null,url:String(form.get('url')||''),text:String(form.get('text')||''),title:String(form.get('title')||'')};
    await new Promise((ok,bad)=>{const r=indexedDB.open('fframestudio.share',1);r.onupgradeneeded=()=>r.result.createObjectStore('intake');r.onerror=()=>bad(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('intake','readwrite');tx.objectStore('intake').put(item,'pending');tx.oncomplete=()=>{db.close();ok();};tx.onerror=()=>bad(tx.error);};});
    return Response.redirect('/?shared=1',303);
  })());
});
