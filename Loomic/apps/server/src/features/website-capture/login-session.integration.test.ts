import { mkdtemp, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { launchAgentBrowser } from "../agent-browser/engine.js";
import { allowLoginRequest, newAuthenticatedContext, signInWebsite } from "./login-session.js";
import { capturePresentationScene } from "./presentation-snapshot.js";
import { recordWebsitePresentation } from "./presentation.js";

it("logs in once, transfers the session, masks credentials and records authenticated content",async()=>{
  const {browser}=await launchAgentBrowser();
  const dir=await mkdtemp(join(tmpdir(),"website-login-"));
  const credentials={loginUrl:"https://login.example/login",successText:"我的工作台",username:"viewer@example.test",password:"Private-test-password"};
  const scope={origin:"https://login.example",submitting:false,username:credentials.username,password:credentials.password};
  let submissions=0;
  try{
    const context=await browser.newContext();
    await context.route("**/*",async route=>{
      if(!allowLoginRequest(route.request(),scope))return route.abort();
      if(route.request().method()==="POST"){
        submissions++;
        expect(route.request().postData()).toContain("password=Private-test-password");
        await route.fulfill({status:302,headers:{location:"/dashboard","set-cookie":"session=authorized; Path=/; Secure; HttpOnly"},body:""});return;
      }
      if(route.request().url().endsWith("/dashboard")){
        await route.fulfill({contentType:"text/html; charset=utf-8",body:"<h1>我的工作台</h1>"});return;
      }
      await route.fulfill({contentType:"text/html; charset=utf-8",body:'<form method="post" action="/login"><input name="username" autocomplete="username"><input type="password" name="password"><button type="submit">登录</button></form>'});
    });
    const page=await context.newPage();
    await signInWebsite(page,credentials,scope,async()=>{});
    expect(submissions).toBe(1);expect(scope.submitting).toBe(false);
    expect(page.video()).toBeNull();
    const signed=await newAuthenticatedContext(browser,context,{dir,size:{width:1280,height:720}},[credentials.username,credentials.password]);
    await signed.route("**/*",async route=>{
      expect((await route.request().allHeaders()).cookie).toContain("session=authorized");
      await route.fulfill({contentType:"text/html; charset=utf-8",body:`<title>体验工作区</title><body style="font:24px sans-serif"><h1>我的工作台</h1><p>已登录的项目与素材</p><p>${credentials.username} ${credentials.password}</p><input value="${credentials.password}"></body>`});
    });
    const content=await signed.newPage();await content.goto("https://login.example/dashboard");
    expect(await content.evaluate("getComputedStyle(document.querySelector('input')).getPropertyValue('-webkit-text-fill-color')")).toBe("rgba(0, 0, 0, 0)");
    const scene=await capturePresentationScene(content);
    expect(JSON.stringify(scene.layers)).not.toContain(credentials.password);
    expect(JSON.stringify(scene.layers)).not.toContain(credentials.username);
    expect(scene.layers.some(layer=>layer.text==="我的工作台")).toBe(true);
    const file=await recordWebsitePresentation({browser,directory:dir,scenes:[scene],config:{style:"cursor-rebuild",durationSeconds:12,cursorCount:4},onPage:async()=>{},checkpoint:async()=>{},onProgress:async()=>{}});
    expect((await readFile(file)).length).toBeGreaterThan(10000);
    const ffmpeg=process.platform==="win32"?resolve("../desktop/resources/ffmpeg/win-x64/ffmpeg.exe"):"ffmpeg";
    const decode=spawnSync(ffmpeg,["-v","error","-xerror","-i",file,"-f","null","-"],{windowsHide:true,timeout:30000,encoding:"utf8"});
    expect(decode.status,decode.stderr).toBe(0);
    const evidence=resolve("../../.creative-test-results/website-login");await mkdir(evidence,{recursive:true});
    await copyFile(file,join(evidence,"authenticated-introduction.webm"));
    const raw=content.video()!;await signed.close();const rawFile=await raw.path();
    const rawDecode=spawnSync(ffmpeg,["-v","error","-xerror","-i",rawFile,"-f","null","-"],{windowsHide:true,timeout:30000,encoding:"utf8"});
    expect(rawDecode.status,rawDecode.stderr).toBe(0);await copyFile(rawFile,join(evidence,"authenticated-browsing.webm"));
  }finally{await browser.close();await rm(dir,{recursive:true,force:true});}
},60000);

it("does not expose fill values in login errors",async()=>{
  const {browser}=await launchAgentBrowser();
  try{
    const page=await browser.newPage();await page.route("**/*",route=>route.fulfill({contentType:"text/html; charset=utf-8",body:'<input type="password"><input type="password">'}));
    const credentials={loginUrl:"https://login.example/login",successText:"工作台",username:"private-account",password:"private-password"};
    await expect(signInWebsite(page,credentials,{origin:"https://login.example",submitting:false,...credentials},async()=>{})).rejects.toThrow("登录未完成");
  }finally{await browser.close();}
});
