import { expect,it } from "vitest";
import { CanvasChangeTracker,canvasElementsForSave,canvasRecoveryIsSaved } from "@/lib/canvas-change-tracker";
const node={id:"node",type:"rectangle",x:100,y:50,width:300,height:180,version:1,locked:false,customData:{workflow:{workflowId:"flow",node:{id:"a",position:{x:100,y:50},config:{kind:"url",url:"https://example.com"}},state:"draft"}}};
it("ignores selection, panning, zoom and runtime node locks but saves real moves",()=>{
  const tracker=new CanvasChangeTracker([node],{viewBackgroundColor:"#fff",gridModeEnabled:false});
  expect(tracker.observe([node],{viewBackgroundColor:"#fff",gridModeEnabled:false,scrollX:50,zoom:{value:.5},selectedElementIds:{node:true}})).toBe(false);
  expect(tracker.observe([{...node,version:2,locked:true,customData:{workflow:{...node.customData.workflow,state:"waiting_approval"}}}],{viewBackgroundColor:"#fff",gridModeEnabled:false})).toBe(false);
  expect(tracker.observe([{...node,x:140,version:3}],{viewBackgroundColor:"#fff",gridModeEnabled:false})).toBe(true);
  expect(tracker.observe([{...node,x:140,version:4}],{viewBackgroundColor:"#fff",gridModeEnabled:false})).toBe(false);
});
it("does not persist temporary workflow locks or remove ordinary user locks",()=>{
  const ordinary={id:"note",type:"rectangle",locked:true};
  expect(canvasElementsForSave([{...node,locked:true},ordinary])).toMatchObject([{locked:false},{locked:true}]);
  expect(ordinary.locked).toBe(true);
});
it("detects deletion, text editing and backdrop changes",()=>{
  const tracker=new CanvasChangeTracker([node],{});
  expect(tracker.observe([{...node,isDeleted:true}],{})).toBe(true);
  expect(tracker.observe([{...node,isDeleted:true},{id:"text",type:"text",text:"内容"}],{})).toBe(true);
  expect(tracker.observe([{...node,isDeleted:true},{id:"text",type:"text",text:"内容"}],{viewBackgroundColor:"#000"})).toBe(true);
});
it("recognizes an already-saved unload copy without discarding differing content or files",()=>{
  const content={elements:[node],appState:{},files:{}};
  expect(canvasRecoveryIsSaved(content,{...content,elements:[{...node,version:50,locked:true}]})).toBe(true);
  expect(canvasRecoveryIsSaved(content,{...content,elements:[{...node,x:250}]})).toBe(false);
  expect(canvasRecoveryIsSaved({...content,files:{photo:{dataURL:"unsaved"}}},content)).toBe(false);
});
