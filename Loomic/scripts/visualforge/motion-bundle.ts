import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

export async function bundleMotionFiles(root:string){
  const gsap=await Bun.build({entrypoints:[resolve(root,"apps/web/node_modules/gsap/gsap-core.js")],target:"browser",format:"esm",minify:true});
  if(!gsap.success)throw new AggregateError(gsap.logs,"Could not bundle the pinned GSAP core");
  return {"/project/src/loomic-gsap.js":await gsap.outputs[0]!.text(),"/project/src/loomic-motion.tsx":await readFile(resolve(root,"scripts/visualforge/motion-player.tsx"),"utf8")};
}
