import {parse} from "../../vendor/visualforge/packages/codemods/node_modules/@babel/parser";
import type {Node,JSXElement} from "../../vendor/visualforge/packages/codemods/node_modules/@babel/types";
import type {VirtualProject} from "../../vendor/visualforge/packages/browser-studio/src/types";
import {resolveCompositionComponentInProject} from "../../vendor/visualforge/packages/codemods/src/resolve-composition-component-location";
import {findProjectFile} from "../../vendor/visualforge/packages/codemods/src/internals";

export function isolateSharedComposition(project:VirtualProject,compositionFile:string,id:string,editId:string):VirtualProject{
  const file=findProjectFile({project,filePath:compositionFile}),source=project.files[file]!;
  const elements:JSXElement[]=[];
  const visit=(node:Node)=>{
    if(node.type==="JSXElement")elements.push(node);
    for(const [key,value] of Object.entries(node)){
      if(["loc","comments","extra","tokens"].includes(key))continue;
      if(Array.isArray(value)){for(const child of value)if(child?.type)visit(child);}
      else if(value&&typeof value==="object"&&"type" in value)visit(value as Node);
    }
  };
  visit(parse(source,{sourceType:"module",plugins:["jsx","typescript"]}));
  const attribute=(element:JSXElement,name:string)=>element.openingElement.attributes.find(item=>item.type==="JSXAttribute"&&item.name.name===name);
  const target=elements.find(element=>{const prop=attribute(element,"id");return prop?.type==="JSXAttribute"&&(prop.value?.type==="StringLiteral"?prop.value.value:prop.value?.type==="JSXExpressionContainer"&&prop.value.expression.type==="StringLiteral"?prop.value.expression.value:null)===id;});
  if(!target)return project;
  const component=attribute(target,"component");
  if(component?.type!=="JSXAttribute"||component.value?.type!=="JSXExpressionContainer"||component.value.expression.type!=="Identifier")return project;
  const symbol=component.value.expression;
  const shared=elements.some(element=>element!==target&&attribute(element,"id")&&(()=>{const prop=attribute(element,"component");return prop?.type==="JSXAttribute"&&prop.value?.type==="JSXExpressionContainer"&&prop.value.expression.type==="Identifier"&&prop.value.expression.name===symbol.name;})());
  if(!shared)return project;
  const resolved=resolveCompositionComponentInProject({project,compositionFile,compositionId:id});
  const scope=`${project.rootDir}/src/loomic-copy-${editId.replaceAll("-","")}`;
  const prefix=`${project.rootDir}/src/`,files={...project.files};
  if(!resolved.filePath.startsWith(prefix))throw new Error("共享合成组件不在工程源码目录，无法安全隔离副本。");
  const visited=new Set<string>();
  const normalize=(path:string)=>{const parts:string[]=[];for(const part of path.split("/")){if(part==="..")parts.pop();else if(part&&part!==".")parts.push(part);}return "/"+parts.join("/");};
  const relativeImport=(fromFile:string,toFile:string)=>{const from=fromFile.slice(0,fromFile.lastIndexOf("/")).split("/"),to=toFile.split("/");let common=0;while(common<from.length&&from[common]===to[common])common++;const path="../".repeat(from.length-common)+to.slice(common).join("/");return path.startsWith(".")?path:`./${path}`;};
  const copySource=(path:string)=>{
    if(visited.has(path))return;visited.add(path);
    if(!path.startsWith(prefix))throw new Error("共享组件依赖位于源码目录之外，无法安全隔离副本。");
    const cloned=`${scope}/${path.slice(prefix.length)}`,contents=project.files[path]!;
    if(files[cloned])throw new Error("合成副本路径已存在，请重新生成方案。");
    if(!/\.[jt]sx?$/.test(path)){files[cloned]=contents;return;}
    const imports:{start:number;end:number;source:string}[]=[];
    const scan=(node:Node)=>{
      const literal=(node.type==="ImportDeclaration"||node.type==="ExportNamedDeclaration"||node.type==="ExportAllDeclaration")?node.source:node.type==="CallExpression"&&node.callee.type==="Import"&&node.arguments[0]?.type==="StringLiteral"?node.arguments[0]:null;
      if(literal&&(literal.value.startsWith(".")||literal.value.startsWith("/"))){
        const base=normalize(literal.value.startsWith("/")?literal.value:path.slice(0,path.lastIndexOf("/")+1)+literal.value);
        const dependency=[base,...[".tsx",".ts",".jsx",".js","/index.tsx","/index.ts","/index.js"].map(ext=>base+ext)].find(name=>project.files[name]!==undefined);
        if(!dependency)throw new Error("共享组件依赖缺失，无法隔离副本。");
        copySource(dependency);imports.push({start:literal.start!,end:literal.end!,source:JSON.stringify(relativeImport(cloned,`${scope}/${dependency.slice(prefix.length)}`))});
      }
      for(const [key,value] of Object.entries(node)){if(["loc","comments","extra","tokens"].includes(key))continue;if(Array.isArray(value)){for(const child of value)if(child?.type)scan(child);}else if(value&&typeof value==="object"&&"type"in value)scan(value as Node);}
    };
    scan(parse(contents,{sourceType:"module",plugins:["jsx","typescript"]}));
    let copied=contents;for(const patch of imports.sort((a,b)=>b.start-a.start))copied=copied.slice(0,patch.start)+patch.source+copied.slice(patch.end);
    files[cloned]=copied;
  };
  copySource(resolved.filePath);
  const clonedFile=`${scope}/${resolved.filePath.slice(prefix.length)}`;
  const clonedSource=files[clonedFile]!;
  if(resolved.exportName!=="default"&&!new RegExp(`export\\s+(?:const|function|class)\\s+${resolved.exportName}\\b|export\\s*\\{[^}]*\\b${resolved.exportName}\\b`).test(clonedSource))files[clonedFile]+=`\nexport {${resolved.exportName}};\n`;
  const alias=`LoomicCopy${editId.replaceAll("-","")}`;
  const from=file.slice(0,file.lastIndexOf("/")).split("/"),to=clonedFile.replace(/\.[tj]sx?$/,"").split("/");
  let common=0;while(common<from.length&&from[common]===to[common])common++;
  const relative="../".repeat(from.length-common)+to.slice(common).join("/");
  const reference=relative.startsWith(".")?relative:`./${relative}`;
  const imported=resolved.exportName==="default"?alias:`{${resolved.exportName} as ${alias}}`;
  files[file]=`import ${imported} from ${JSON.stringify(reference)};\n${source.slice(0,symbol.start!)}${alias}${source.slice(symbol.end!)}`;
  return {...project,files};
}
