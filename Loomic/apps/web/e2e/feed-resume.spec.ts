import {test,expect} from "@playwright/test";

test("restores a saved package at an earlier URL step and keeps downstream navigation after reload",async({page},info)=>{
  const id="11111111-1111-4111-8111-111111111111";
  const record={id,title:"已保存的内容包",brief:"真实说明",status:"structured",platforms:["douyin"],duration_seconds:15,workflow_mode:"review",structure:{title:"已保存脚本",hook:"开场",audience:"客户",painPoint:"问题",angle:"真实场景",hypothesis:"假设",evidence:["依据"],cta:"查看",riskNotes:[],imagePrompt:"封面",videoPrompt:"视频",shots:[{id:"shot",startSecond:0,endSecond:5,visual:"场景",voiceover:"解说",subtitle:"字幕"}]},variants:[]};
  const mutations:string[]=[];
  await page.route("**/api/**",async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==="/api/metrics")return route.fulfill({status:204});
    if(request.method()!=="GET"){mutations.push(request.method()+" "+path);return route.fulfill({status:405,json:{}});}
    if(path==="/api/local-auth/session")return route.fulfill({json:{session:{access_token:"fixture",user:{id,email:"feed@example.test"}}}});
    if(path==="/api/feed/packages")return route.fulfill({json:{ok:true,data:[record]}});
    if(path===`/api/feed/packages/${id}`)return route.fulfill({json:{ok:true,data:record}});
    if(path==="/api/video-models")return route.fulfill({json:{models:[],unavailableModels:[]}});
    if(path==="/api/feed/trends"){await new Promise(resolve=>setTimeout(resolve,1000));return route.fulfill({json:{ok:true,data:{items:[],page:1,total:0,totalPages:1}}});}
    if(path==="/api/feed/accounts"||path==="/api/feed/sources")return route.fulfill({json:{ok:true,data:[]}});
    if(path==="/api/agent/browser/sessions")return route.fulfill({json:{enabled:true,sessions:[]}});
    return route.fulfill({status:404,json:{}});
  });
  await page.goto(`/feed/?packageId=${id}&step=0`);
  const script=page.getByRole("button",{name:"3 of 6: 脚本",exact:true});
  await expect(script).toBeEnabled();await script.click();
  await expect(page).toHaveURL(/step=2/);
  await page.getByRole("button",{name:"1 of 6: 选题",exact:true}).click();
  await expect(page).toHaveURL(/step=0/);await page.reload();
  await expect(script).toBeEnabled();await script.click();
  await expect(page).toHaveURL(new RegExp(`packageId=${id}.*step=2`));
  expect(mutations).toEqual([]);
  await page.screenshot({path:info.outputPath("saved-package-resumed.png")});
});
