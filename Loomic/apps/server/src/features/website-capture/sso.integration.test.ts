import {expect,it} from 'vitest';
import {launchAgentBrowser} from '../agent-browser/engine.js';
import {allowLoginRequest,isAllowedLoginNavigation,type LoginNetworkScope} from './login-session.js';
it('observes an identity redirect and sends no account data until that exact origin is approved',async()=>{
 const {browser}=await launchAgentBrowser();try{
  const context=await browser.newContext(),scope:LoginNetworkScope={origin:'https://8.8.8.8',username:'',password:'',human:true,submitting:false,allowedOrigins:[],proposedOrigins:new Map()};
  const sent:string[]=[];
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(route.request().isNavigationRequest()&&!isAllowedLoginNavigation(url.href,scope.origin,false,scope.allowedOrigins)){scope.proposedOrigins!.set(url.origin,url.href);await route.abort();return;}
   if(!allowLoginRequest(route.request(),scope)){await route.abort();return;}
   sent.push(url.origin);
   if(url.origin==='https://8.8.8.8')await route.fulfill({contentType:'text/html',body:'<a href="https://1.1.1.1/oauth">SSO login</a>'});
   else await route.fulfill({contentType:'text/html',body:'<h1>Identity login</h1>'});
  });
  const page=await context.newPage();await page.goto('https://8.8.8.8/');await page.getByRole('link',{name:'SSO login'}).click({noWaitAfter:true});await page.waitForTimeout(100);
  expect(scope.proposedOrigins?.has('https://1.1.1.1')).toBe(true);expect(sent).not.toContain('https://1.1.1.1');
  scope.allowedOrigins!.push('https://1.1.1.1');await page.goto(scope.proposedOrigins!.get('https://1.1.1.1')!);expect(await page.locator('h1').innerText()).toBe('Identity login');
  expect(isAllowedLoginNavigation('https://evil.example/oauth',scope.origin,false,scope.allowedOrigins)).toBe(false);
 }finally{await browser.close();}
});
