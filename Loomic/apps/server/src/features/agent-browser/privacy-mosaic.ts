import type { BrowserContext,Page } from "playwright";

export const PRIVATE_FIELDS='input[type="password"],input[autocomplete="one-time-code"],input[autocomplete="cc-number"],input[autocomplete="cc-csc"]';
export const ALL_FIELDS='input,textarea,select,[contenteditable="true"]';
// The pattern does not sample private pixels: short values cannot be reconstructed from its blocks.
const tile='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#c4ccd9" d="M0 0h32v32H0z"/><path fill="#dce1e9" d="M0 0h8v8H0zM16 8h8v8h-8zM8 24h8v8H8zM24 24h8v8h-8z"/><path fill="#aeb9cb" d="M16 0h8v8h-8zM0 16h8v8H0zM24 8h8v8h-8zM16 24h8v8h-8z"/><path fill="#e7ebf1" d="M8 8h8v8H8zM16 16h8v8h-8zM24 0h8v8h-8z"/></svg>';
export function mosaicStyle(all=false){
  const selector=all?ALL_FIELDS:PRIVATE_FIELDS;
  return `${selector}{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;background-color:#c4ccd9!important;background-image:url("data:image/svg+xml,${encodeURIComponent(tile)}")!important;background-size:32px 32px!important;background-repeat:repeat!important;box-shadow:none!important;} ${selector.split(',').map(s=>s+'::placeholder').join(',')}{color:transparent!important;-webkit-text-fill-color:transparent!important;} [contenteditable="true"] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;}`;
}
export async function mosaicScreenshot(page:Page,all=false,options:{quality?:number;fullPage?:boolean;clip?:{x:number;y:number;width:number;height:number};timeout?:number}={}){
  return page.screenshot({type:'jpeg',quality:options.quality??76,style:mosaicStyle(all),...options});
}
export async function installPrivacyMosaic(context:BrowserContext,all=true){
  await context.addInitScript(`(()=>{const css=${JSON.stringify(mosaicStyle(all))};document.addEventListener('invalid',event=>event.preventDefault(),true);let sheet;const apply=()=>{if(!document.documentElement)return;if(!sheet?.isConnected){sheet=document.createElement('style');sheet.textContent=css;document.documentElement.append(sheet);}};new MutationObserver(apply).observe(document,{childList:true,subtree:true});apply();})()`);
}
