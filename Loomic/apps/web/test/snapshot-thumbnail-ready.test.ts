import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {afterEach,expect,it,vi} from "vitest";
import {waitFor} from "@testing-library/react";

const script=readFileSync(resolve(process.cwd(),"../desktop/resources/snapshot-media.js"),"utf8");
const originalDecode=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"decode");
afterEach(()=>{vi.restoreAllMocks();document.body.replaceChildren();if(originalDecode)Object.defineProperty(HTMLImageElement.prototype,"decode",originalDecode);else Reflect.deleteProperty(HTMLImageElement.prototype,"decode");});
function renderThumbnails(decode:()=>Promise<void>) {
  document.body.innerHTML='<div id="media-list"></div><div id="media-preview"></div>';
  Object.defineProperty(HTMLImageElement.prototype,"decode",{value:vi.fn(decode),configurable:true});
  const context:{showSnapshotMedia?:(items:unknown[],scope:unknown)=>void;electronAPI:unknown}={electronAPI:{getSnapshotThumbnail:async()=>({url:"data:image/png;base64,AA=="})}};
  class Observer {constructor(private notify:(entries:{isIntersecting:boolean}[])=>void){} observe(){queueMicrotask(()=>this.notify([{isIntersecting:true}]));}disconnect(){}}
  runInNewContext(script,{window:context,document,IntersectionObserver:Observer});
  context.showSnapshotMedia!([{name:"video.mp4",assetId:"asset"}],{id:"snapshot",account:"owner"});
}
it("keeps the loading state until the thumbnail has decoded",async()=>{
  let finish!:()=>void;
  const decoded=new Promise<void>(resolve=>{finish=resolve;});
  renderThumbnails(()=>decoded);
  await waitFor(()=>expect(HTMLImageElement.prototype.decode).toHaveBeenCalledOnce());
  expect(document.querySelector("#media-list img")).toBeNull();
  expect(document.body.textContent).toContain("正在准备本地封面");
  finish();
  await waitFor(()=>expect(document.querySelectorAll("#media-list img")).toHaveLength(1));
});
it("shows a recoverable error instead of leaving a broken image",async()=>{
  renderThumbnails(()=>Promise.reject(new Error("本地封面读取失败，请重新打开")));
  await waitFor(()=>expect(document.body.textContent).toContain("封面不可用"));
  expect(document.body.textContent).toContain("请重新打开");
  expect(document.querySelector("#media-list img")).toBeNull();
});
