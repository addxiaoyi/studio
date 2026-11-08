type Element = Record<string, unknown>;
const volatile = new Set(["version", "versionNonce", "updated"]);
function ordered(value:unknown):unknown {
  if(Array.isArray(value))return value.map(ordered);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)]));
  return value;
}
function durableElement(element:Element){
  const custom=element.customData as Record<string,unknown>|undefined;
  const workflow=custom?.workflow as Record<string,unknown>|undefined;
  return Object.fromEntries(Object.entries(element).filter(([key])=>!volatile.has(key)&&!(key==="locked"&&(workflow||custom?.workflowEdge))).map(([key,value])=>{
    if(key!=="customData"||!workflow)return [key,value];
    const {state:_state,preview:_preview,issue:_issue,references:_references,...saved}=workflow;
    return [key,{...custom,workflow:saved}];
  }));
}
export function canvasElementsForSave(elements:readonly Element[]):Element[]{
  return elements.map(element=>{
    const custom=element.customData as Record<string,unknown>|undefined;
    return custom?.workflow||custom?.workflowEdge?{...element,locked:false}:element;
  });
}
export function canvasRecoveryIsSaved(local:{elements:Element[];appState:Record<string,unknown>;files:Record<string,Record<string,unknown>>},remote:{elements:Element[];appState:Record<string,unknown>;files:Record<string,Record<string,unknown>>}){
  const byId=new Map(remote.elements.map(element=>[element.id,element]));
  if(local.elements.some(element=>!byId.has(element.id)||JSON.stringify(ordered(durableElement(element)))!==JSON.stringify(ordered(durableElement(byId.get(element.id)!)))))return false;
  for(const [id,file] of Object.entries(local.files)){
    const saved=remote.files[id];if(!saved)return false;
    if(file.dataURL!==saved.dataURL||file.storageUrl!==saved.storageUrl||file.mimeType!==saved.mimeType)return false;
  }
  return (local.appState.viewBackgroundColor??"#ffffff")===(remote.appState.viewBackgroundColor??"#ffffff")&&(local.appState.gridModeEnabled??false)===(remote.appState.gridModeEnabled??false);
}
export class CanvasChangeTracker{
  private key:string;
  constructor(elements:readonly Element[],state:Record<string,unknown>){this.key=this.snapshot(elements,state);}
  private snapshot(elements:readonly Element[],state:Record<string,unknown>){return JSON.stringify(ordered({elements:elements.map(durableElement),background:state.viewBackgroundColor??"#ffffff",grid:state.gridModeEnabled??false}));}
  observe(elements:readonly Element[],state:Record<string,unknown>){const next=this.snapshot(elements,state);if(next===this.key)return false;this.key=next;return true;}
}
