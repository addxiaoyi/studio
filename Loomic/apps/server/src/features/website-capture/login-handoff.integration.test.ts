import { expect,it } from 'vitest';
import { launchAgentBrowser } from '../agent-browser/engine.js';
import { applyHandoffInput } from './login-handoff.js';
it('replaces only the focused editable field and preserves focus across tab',async()=>{
 const {browser}=await launchAgentBrowser();try{
  const page=await browser.newPage();await page.setContent('<input type="email" value="old"><input type="password"><button>Login</button>');
  await expect(applyHandoffInput(page,{kind:'text',text:'secret'})).rejects.toThrow('输入框');
  await page.locator('input[type="email"]').focus();await applyHandoffInput(page,{kind:'text',text:'account@example.test'});
  await applyHandoffInput(page,{kind:'key',key:'Tab'});await applyHandoffInput(page,{kind:'text',text:'private-password'});
  expect(await page.locator('input[type="email"]').inputValue()).toBe('account@example.test');expect(await page.locator('input[type="password"]').inputValue()).toBe('private-password');
 }finally{await browser.close();}
});
