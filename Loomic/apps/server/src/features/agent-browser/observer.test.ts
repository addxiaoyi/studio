import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright";
import { expect,it,vi } from "vitest";
import type { BrowserViewStore } from "./store.js";
import { observeAgentBrowser } from "./observer.js";

it("serializes periodic and requested frames through the file publication step",async()=>{
  let active=0,maximum=0,writes=0;
  const page={isClosed:()=>false,locator:()=>({}),viewportSize:()=>({width:1280,height:720}),url:()=>"https://example.test/",title:async()=>"Page",
    screenshot:async()=>{active++;maximum=Math.max(maximum,active);await delay(20);return Buffer.from([255,216,255]);},
  } as unknown as Page;
  const store={create:async()=>"view",writeFrame:async()=>{await delay(20);active--;writes++;},activity:vi.fn(),finish:vi.fn()} as unknown as BrowserViewStore;
  const observer=await observeAgentBrowser({page,store,taskId:"task",userId:"user",workspaceId:"workspace",engine:"chromium",assertActive:async()=>{}});
  try{await Promise.all(Array.from({length:5},()=>observer.capture()));expect(maximum).toBe(1);expect(writes).toBeGreaterThanOrEqual(5);}
  finally{await observer.close("completed","Done");}
  expect(active).toBe(0);
});
