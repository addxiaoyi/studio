"use client";
import type { WebsiteLoginCredentials } from "@helstera/shared";

export function WebsiteLoginFields({value,onChange}:{value:WebsiteLoginCredentials;onChange:(value:WebsiteLoginCredentials)=>void}) {
  const interactive=value.method==='interactive';
  return <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" aria-label="网站登录信息">
    {interactive?<p className="text-xs text-muted-foreground">Agent 会打开登录页，请在实时画面中扫码或完成验证，再继续原任务。</p>:<>
      <label>网站账号<input className="website-presentation-input" value={value.username} onChange={e=>onChange({...value,username:e.target.value})} autoComplete="off" /></label>
      <label>网站密码<input className="website-presentation-input" type="password" value={value.password} onChange={e=>onChange({...value,password:e.target.value})} autoComplete="new-password" /></label>
      <p className="text-xs text-muted-foreground">自动寻找登录入口并判断登录结果。账号密码不会进入 AI 对话，登录画面不录制。</p>
    </>}
    <label className="!flex items-center gap-2"><input className="size-4 shrink-0 accent-primary" type="checkbox" checked={value.rememberSession??false} onChange={e=>onChange({...value,rememberSession:e.target.checked})}/><span>记住此网站会话 24 小时</span></label>
    <details><summary className="cursor-pointer text-xs text-muted-foreground">高级登录设置（可选）</summary><div className="mt-3 space-y-3">
      <label>登录地址<input className="website-presentation-input" type="url" value={value.loginUrl} onChange={e=>onChange({...value,loginUrl:e.target.value})} autoComplete="off" /></label>
      <label>登录成功后可见的文字<input className="website-presentation-input" value={value.successText??''} onChange={e=>onChange({...value,successText:e.target.value})} placeholder="默认自动判断" /></label>
      {([['usernameSelector','账号框'],['passwordSelector','密码框'],['submitSelector','登录按钮']] as const).map(([key,label])=><label key={key}>{label} CSS 选择器<input className="website-presentation-input" value={value[key]??''} onChange={e=>{const next={...value};if(e.target.value)next[key]=e.target.value;else delete next[key];onChange(next);}} placeholder="自动识别" /></label>)}
    </div></details>
  </div>;
}
