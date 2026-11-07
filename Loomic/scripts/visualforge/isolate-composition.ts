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
  for(const [path,contents] of Object.entries(project.files))if(path.startsWith(prefix)){
    const cloned=`${scope}/${path.slice(prefix.length)}`;
    if(files[cloned])throw new Error("合成副本路径已存在，请重新生成方案。");
    files[cloned]=contents;
  }
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
