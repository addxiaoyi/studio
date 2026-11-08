import type { Page } from "playwright";
import type { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import type { WebsiteHandoffInput } from "@helstera/shared";
import { browserViewStore,publicBrowserUrl } from "../agent-browser/store.js";
import { observeAgentBrowser } from "../agent-browser/observer.js";
import { takeHandoffInput,finishHandoffInput,endHandoff } from "./handoff-store.js";

export async function applyHandoffInput(page:Page,input:WebsiteHandoffInput){
  const size=page.viewportSize()??{width:1280,height:720};
  switch(input.kind){
    case 'click':await page.mouse.click(input.x*size.width,input.y*size.height);break;
    case 'drag':await page.mouse.move(input.x*size.width,input.y*size.height);await page.mouse.down();try{await page.mouse.move(input.toX*size.width,input.toY*size.height,{steps:20});}finally{await page.mouse.up();}break;
    case 'text':{
      const field=page.locator('input:focus,textarea:focus,[contenteditable="true"]:focus');
      if(await field.count()!==1||!await field.isEditable())throw new Error('请先选择登录输入框。');
      await field.fill(input.text,{timeout:3000});break;
    }
    case 'key':await page.keyboard.press(input.key);break;
    case 'scroll':await page.mouse.wheel(0,input.delta);break;
    case 'resume':break;
  }
}
export async function waitForWebsiteLogin(options:{page:Page;db:Pool;storageRoot:string;taskId:string;workspaceId:string;userId:string;engine:'chromix'|'chromium';assertActive:()=>Promise<void>;check:()=>Promise<boolean>;heartbeat:()=>Promise<void>;timeoutMs?:number}){
  const store=browserViewStore(options.db,options.storageRoot);
  const view=await observeAgentBrowser({page:options.page,store,taskId:options.taskId,workspaceId:options.workspaceId,userId:options.userId,engine:options.engine,name:'请完成登录验证',maskAllInputs:true,assertActive:options.assertActive});
  await options.db.query("update website_capture_tasks set stage='waiting_login',updated_at=now() where id=$1 and status='running'",[options.taskId]);
  await store.enableHandoff(view.id);
  const deadline=Date.now()+(options.timeoutMs??10*60_000);let heartbeatAt=0;
  try{
    await store.activity(view.id,null,'请在下方画面完成验证码或扫码，然后点击“验证完成，继续录制”。登录画面不会进入录像。');
    while(Date.now()<deadline){
      await options.assertActive();
      if(Date.now()-heartbeatAt>5000){await options.heartbeat();heartbeatAt=Date.now();}
      const command=await takeHandoffInput(options.db,view.id);
      if(!command){await delay(180);continue;}
      try{
        if(publicBrowserUrl(options.page.url())!==command.pageUrl)throw new Error('登录页面已变化');
        if(command.input.kind==='resume'){
          if(!await options.check())throw new Error('尚未检测到登录完成，请先完成页面验证。');
          await finishHandoffInput(options.db,command.id,true);return;
        }
        await applyHandoffInput(options.page,command.input);
        const focus=await options.page.evaluate(`(()=>{const el=document.activeElement;if(!el||!el.matches('input,textarea,[contenteditable="true"]'))return '';return el.type==='password'?'密码':el.autocomplete==='one-time-code'?'验证码':el.type==='email'?'邮箱':(el.getAttribute('aria-label')||el.name||'文字输入框').slice(0,60);})()`) as string;
        await store.activity(view.id,null,focus?`当前输入框：${focus}。输入会替换此框内容，所有输入值均已隐藏。`:'请完成登录验证后点击继续；登录画面不会进入录像。');
        await view.capture();
        await finishHandoffInput(options.db,command.id,true);
      }catch{
        await finishHandoffInput(options.db,command.id,false);
        await store.activity(view.id,null,'本次操作未完成或仍需登录验证，请查看当前画面后重试。');
      }
    }
    throw new Error('登录接管等待超过10分钟，本次任务已停止，请重新发起。');
  }finally{
    await endHandoff(options.db,view.id);
    await view.close('completed','登录验证画面已清除');
    await store.eraseLoginView(view.id);
  }
}
