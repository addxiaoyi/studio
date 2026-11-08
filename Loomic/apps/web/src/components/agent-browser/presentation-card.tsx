"use client";
import { useEffect, useState } from "react";
import { Film, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import { useWebsitePresentation } from "@/hooks/use-website-presentation";
import { WebsiteLoginFields } from "./website-login-fields";
import type { WebsiteLoginCredentials } from "@helstera/shared";
import { AuthenticatedRecording } from "@/components/chat/authenticated-recording";

export function WebsitePresentationCard({
  userId,
  token,
  sourceUrl,
}: { userId: string; token: string; sourceUrl: string }) {
  const [expanded, setExpanded] = useState(false),
    [url, setUrl] = useState(sourceUrl),
    [duration, setDuration] = useState("24"),
    [cursors, setCursors] = useState("4");
  const form = useWebsitePresentation(userId, token);
  const [needsLogin,setNeedsLogin]=useState(false),[recordingMode,setRecordingMode]=useState("presentation");
  const [credentials,setCredentials]=useState<WebsiteLoginCredentials>({loginUrl:"",username:"",password:"",successText:""});
  useEffect(()=>{if(form.saved)setCredentials(value=>({...value,username:"",password:""}));},[form.saved?.key]);
  useEffect(()=>{if(form.saved)setExpanded(true);},[form.saved?.key]);
  useEffect(() => {
    if (!form.saved && sourceUrl) setUrl(sourceUrl);
  }, [sourceUrl]);
  const task = form.task,
    terminal =
      task && ["succeeded", "failed", "canceled"].includes(task.status);
  const recording = task?.result?.recordingAssetId;
  const config = form.approval?.action.presentation;
  function prepare() {
    void form.prepare(url, recordingMode==="presentation"?{
      style: "cursor-rebuild",
      durationSeconds: Number(duration),
      cursorCount: Number(cursors),
    }:undefined,needsLogin?credentials:undefined);
  }
  return (
    <section className="website-presentation-card" aria-label="网站介绍演示">
      <button
        type="button"
        className="website-presentation-heading"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Film aria-hidden="true" />
        <span>网站介绍演示与录制</span>
        <span>{expanded ? "收起" : "展开"}</span>
      </button>
      {expanded && (
        <div className="website-presentation-body">
          <p>
            多光标依次描绘网页布局、打出文字和铺放图片，自动录制为
            WebM。也可选择登录后录制站内浏览，任务限定在确认的网站内。
          </p>
          {!form.saved ? (
            <>
              <label>
                演示网址
                <input
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com"
                  className="website-presentation-input"
                />
              </label>
              <label>录制方式<StyledSelect aria-label="录制方式" value={recordingMode} onChange={setRecordingMode} options={[{value:"presentation",label:"多光标介绍演示"},{value:"browsing",label:"真实浏览录屏"}]} /></label>
              <label className="!flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"><input className="size-4 shrink-0 accent-primary" type="checkbox" checked={needsLogin} onChange={e=>{setNeedsLogin(e.target.checked);if(!e.target.checked)setCredentials(value=>({...value,username:"",password:""}));}} /><span>需要登录后体验</span></label>
              {needsLogin&&<WebsiteLoginFields value={credentials} onChange={setCredentials} />}
              {recordingMode==="browsing"&&<p>录制目标页面及最多 3 个站内页面，自动滚动查看内容；不会提交业务表单或支付。</p>}
              {recordingMode==="presentation"&&
              <div className="website-presentation-options">
                <label>
                  演示时长
                  <StyledSelect
                    aria-label="演示时长"
                    value={duration}
                    onChange={setDuration}
                    options={[12, 24, 36, 60].map((value) => ({
                      value: String(value),
                      label: `${value} 秒`,
                    }))}
                  />
                </label>
                <label>
                  光标数量
                  <StyledSelect
                    aria-label="光标数量"
                    value={cursors}
                    onChange={setCursors}
                    options={[2, 4, 6].map((value) => ({
                      value: String(value),
                      label: `${value} 个光标`,
                    }))}
                  />
                </label>
              </div>
              }
              <Button
                size="sm"
                disabled={form.busy || !url.trim() || (needsLogin&&(!credentials.loginUrl||!credentials.username||!credentials.password||!credentials.successText))}
                onClick={prepare}
              >
                {form.busy ? "正在准备…" : "查看录制方案"}
              </Button>
            </>
          ) : !task ? (
            <>
              <p>正在恢复上一次请求，重试会沿用同一任务。</p>
              <Button size="sm" disabled={form.busy} onClick={prepare}>
                恢复演示请求
              </Button>
            </>
          ) : null}
          {form.approval && (
            <div
              className="website-presentation-approval"
              aria-label="网站演示录制确认"
            >
              <strong>确认网站演示与录制</strong>
              <p className="break-all">{form.approval.action.url}</p>
              <p>
                {form.saved?.input.presentation ? <>
                {config?.durationSeconds ??
                  form.saved?.input.presentation?.durationSeconds}{" "}
                秒 ·{" "}
                {config?.cursorCount ??
                  form.saved?.input.presentation?.cursorCount}{" "}
                个光标 · 1280 × 720 · WebM
                </> : "真实站内浏览录屏 · 1280 × 720 · WebM"}
              </p>
              {form.saved?.input.login&&<p>将使用本次提供的账号登录 {new URL(form.saved.input.login.loginUrl).origin}，确认后读取并录制账号内页面。登录成功标记：{form.saved.input.login.successText}。凭据使用后销毁。</p>}
              <p>
                不调用付费生成模型，不扣生成积分。确认后访问指定网页，录制副本进入素材库
                {form.saved?.input.sessionId ? "并回写当前聊天" : ""}。
              </p>
              <div className="website-presentation-buttons">
                <Button size="sm" disabled={form.busy} onClick={form.approve}>
                  确认演示并录制
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={form.busy}
                  onClick={form.reject}
                >
                  拒绝
                </Button>
              </div>
            </div>
          )}
          {task && !form.approval && (
            <div role="status">
              <p>
                {task.status === "succeeded"
                  ? "演示录像已保存"
                  : task.status === "canceled"
                    ? "演示已取消"
                    : task.status === "failed"
                      ? "演示未完成"
                      : task.stage === "signing_in" ? "正在登录，登录画面不会录制" : task.stage === "signed_in" ? "登录成功，准备录制" : task.stage === "presentation_recording"
                        ? "多光标演示正在播放并录制"
                        : "正在准备网页与演示场景"}{" "}
                · {task.progress}%
              </p>
              {task.error && <p className="text-destructive">{task.error}</p>}
            </div>
          )}
          {recording && (
            <AuthenticatedRecording
              assetId={recording}
              accessToken={token}
              label="网站介绍演示录像"
              downloadName="website-introduction.webm"
            />
          )}
          {task && !terminal && !form.approval && (
            <Button
              size="sm"
              variant="outline"
              onClick={form.cancel}
              disabled={form.busy}
            >
              取消演示任务
            </Button>
          )}
          {terminal && (
            <Button size="sm" variant="outline" onClick={form.reset}>
              制作新的演示
            </Button>
          )}
          {form.error && (
            <div role="alert" className="text-sm text-destructive">
              <p>{form.error}</p>
              <Button size="sm" variant="outline" onClick={form.retry}>
                <RefreshCw />
                重试读取状态
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
