import {createServer,request} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";
const root=resolve(process.env.HELT_WORKFLOW_STATIC_ROOT||"apps/web/out");
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".txt":"text/plain",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".woff2":"font/woff2",".wasm":"application/wasm"};
createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||"/","http://127.0.0.1:3228");
    if(url.pathname.startsWith("/api/")){
      const proxy=request({hostname:"127.0.0.1",port:3315,path:url.pathname+url.search,method:req.method,headers:req.headers},upstream=>{res.writeHead(upstream.statusCode||502,upstream.headers);upstream.pipe(res);});
      proxy.on("error",error=>{console.error("[workflow-candidate] API",error.message);if(!res.headersSent)res.writeHead(502);res.end("Local test API unavailable");});req.pipe(proxy);return;
    }
    let path=resolve(root,"."+decodeURIComponent(url.pathname));
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    if((await stat(path)).isDirectory())path=resolve(path,"index.html");
    res.writeHead(200,{"Content-Type":mime[extname(path)]||"application/octet-stream","Cache-Control":"no-store"});res.end(await readFile(path));
  }catch(error){if(error.code!=="ENOENT")console.error("[workflow-candidate] static",error);if(!res.headersSent)res.writeHead(error.code==="ENOENT"?404:500);res.end("Candidate page unavailable");}
}).listen(3228,"127.0.0.1",()=>console.log("WORKFLOW_STATIC_READY"));
