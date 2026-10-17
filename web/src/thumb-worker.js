// Decode thumbnails off the UI thread. The main thread only transfers bitmap pixels.
self.onmessage=async({data:{id,url}})=>{try{const r=await fetch(url);if(!r.ok)throw Error(r.status);const bitmap=await createImageBitmap(await r.blob());self.postMessage({id,bitmap},[bitmap]);}catch{self.postMessage({id,error:true});}};
