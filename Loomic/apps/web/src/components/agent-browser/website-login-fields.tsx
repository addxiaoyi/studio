"use client";
import type { WebsiteLoginCredentials } from "@helstera/shared";

export function WebsiteLoginFields({value,onChange}:{value:WebsiteLoginCredentials;onChange:(value:WebsiteLoginCredentials)=>void}) {
  return <fieldset className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
    <legend className="px-1 text-sm font-medium">登录后体验</legend>
    <p className="text-xs text-muted-foreground">登录过程不录制。凭据仅用于本次任务，15 分钟内有效；任务使用后销毁。录制结果仅对你可见。</p>
    <label>登录地址<input className="website-presentation-input" type="url" value={value.loginUrl} onChange={e=>onChange({...value,loginUrl:e.target.value})} placeholder="https://example.com/login" autoComplete="off" /></label>
    <label>网站账号<input className="website-presentation-input" value={value.username} onChange={e=>onChange({...value,username:e.target.value})} autoComplete="off" /></label>
    <label>网站密码<input className="website-presentation-input" type="password" value={value.password} onChange={e=>onChange({...value,password:e.target.value})} autoComplete="new-password" /></label>
    <label>登录成功后可见的文字<input className="website-presentation-input" value={value.successText} onChange={e=>onChange({...value,successText:e.target.value})} placeholder="例如：我的工作台" /></label>
    <p className="text-xs text-muted-foreground">用于确认已进入账号内，避免把登录失败页面录成结果。验证码、扫码和二次验证请使用本地已登录浏览器。</p>
    <details><summary className="cursor-pointer text-xs">高级：指定登录控件</summary><div className="mt-2 space-y-2">
      {([['usernameSelector','账号框'],['passwordSelector','密码框'],['submitSelector','登录按钮']] as const).map(([key,label])=><label key={key}>{label} CSS 选择器<input className="website-presentation-input" value={value[key]??''} onChange={e=>{const next={...value};if(e.target.value)next[key]=e.target.value;else delete next[key];onChange(next);}} placeholder="自动识别" /></label>)}
    </div></details>
  </fieldset>;
}
