import {createServer,request} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";
const root=resolve(process.env.HELT_WORKFLOW_STATIC_ROOT||"apps/web/out");
const port=Number(process.env.HELT_WORKFLOW_STATIC_PORT||3228);
const apiPort=Number(process.env.HELT_WORKFLOW_API_PORT||3315);
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".json":"application/json",".txt":"text/plain",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".woff2":"font/woff2",".wasm":"application/wasm"};
const handler=async(req,res)=>{
  try{
    const url=new URL(req.url||"/","http://127.0.0.1:3228");
    if(url.pathname.startsWith("/api/")){
      const proxy=request({hostname:"127.0.0.1",port:apiPort,path:url.pathname+url.search,method:req.method,headers:req.headers},upstream=>{res.writeHead(upstream.statusCode||502,upstream.headers);upstream.pipe(res);});
      proxy.on("error",error=>{console.error("[workflow-candidate] API",error.message);if(!res.headersSent)res.writeHead(502);res.end("Local test API unavailable");});req.pipe(proxy);return;
    }
    let path=resolve(root,"."+decodeURIComponent(url.pathname));
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    if((await stat(path)).isDirectory())path=resolve(path,"index.html");
    const headers={"Content-Type":mime[extname(path)]||"application/octet-stream","Cache-Control":"no-store", ...(/^\/(video|creative\/visualforge)(\/|$)/.test(url.pathname)?{"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"credentialless"}:{})};
    if(url.pathname.startsWith("/creative/")&&/\bgzip\b/.test(req.headers["accept-encoding"]||"")){
      try{await stat(path+".gz");path+=".gz";headers["Content-Encoding"]="gzip";headers.Vary="Accept-Encoding";}
      catch(error){if(error.code!=="ENOENT")throw error;}
    }
    const bytes=await readFile(path);headers["Content-Length"]=bytes.length;
    res.writeHead(200,headers);res.end(bytes);
  }catch(error){if(error.code!=="ENOENT")console.error("[workflow-candidate] static",error);if(!res.headersSent)res.writeHead(error.code==="ENOENT"?404:500);res.end("Candidate page unavailable");}
};
createServer(handler).listen(port,"127.0.0.1",()=>console.log("WORKFLOW_STATIC_READY"));
if(process.env.HELT_WORKFLOW_STATIC_ROOT) createServer(handler).listen(3001,"127.0.0.1",()=>console.log("WORKFLOW_API_PROXY_READY"));
