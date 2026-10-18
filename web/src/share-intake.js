export function consumeSharedReference() {
  return new Promise((ok,bad)=>{const r=indexedDB.open('fframestudio.share',1);r.onupgradeneeded=()=>r.result.createObjectStore('intake');r.onerror=()=>bad(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('intake','readwrite'),s=tx.objectStore('intake'),get=s.get('pending');let result;get.onsuccess=()=>{result=get.result;s.delete('pending');};tx.oncomplete=()=>{db.close();ok(result);};tx.onerror=()=>bad(tx.error);};});
}
