// Plain static server used by hosted journeys: no bridge routes, SPA fallback or API mocks.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
export async function staticSite(root) {
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  const security=Object.fromEntries(config.headers[0].headers.map(h=>[h.key,h.value]));
  const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.woff2':'font/woff2','.ttf':'font/ttf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'};
  const requests=[];
  const server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://static.invalid');requests.push({path:u.pathname,method:req.method,hasToken:u.searchParams.has('token'),authorization:!!req.headers.authorization});
    let rel;try{rel=decodeURIComponent(u.pathname);}catch{res.writeHead(400);res.end();return;}
    const file=path.resolve(root,'.'+(rel==='/'?'/index.html':rel));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404,security);res.end();return;}
    const size=fs.statSync(file).size,range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
    const headers={...security,'Content-Type':mime[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes'};
    if(range){const start=+range[1],end=range[2]?Math.min(+range[2],size-1):size-1;if(start>=size){res.writeHead(416);res.end();return;}res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${size}`});fs.createReadStream(file,{start,end}).pipe(res);}
    else {res.writeHead(200,{...headers,'Content-Length':size});fs.createReadStream(file).pipe(res);}
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  return {base:`http://127.0.0.1:${server.address().port}`,requests,close:()=>new Promise(ok=>{server.closeAllConnections();server.close(ok);})};
}
