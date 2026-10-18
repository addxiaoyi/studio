"use client";

import { useEffect, useState } from "react";
import { useCreateProject } from "@/hooks/use-create-project";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FLOW_STEPS = [
  ["01", "故事设定", "确定题材、受众和整体风格"],
  ["02", "角色与场景", "整理可复用的视觉资产"],
  ["03", "分镜创作", "把剧本拆成镜头和画面"],
  ["04", "视频与配音", "生成片段并合成成片"],
] as const;

const PROJECT_TYPES = [
  { id: "series", label: "AI 漫剧", description: "连续剧集、角色和分镜" },
  { id: "film", label: "AI 短片", description: "电影感镜头和视频片段" },
  { id: "comic", label: "静态漫画", description: "故事、角色和连续画面" },
] as const;
const CREATION_DRAFT_KEY = "helstera:create-workspace-draft:v1";

export default function CreatePage() {
  const { create, creating } = useCreateProject();
  const [type, setType] = useState<(typeof PROJECT_TYPES)[number]["id"]>("series");
  const [brief, setBrief] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(CREATION_DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved) as { type?: string; brief?: string };
        if (PROJECT_TYPES.some((item) => item.id === draft.type)) {
          setType(draft.type as (typeof PROJECT_TYPES)[number]["id"]);
        }
        if (typeof draft.brief === "string") setBrief(draft.brief.slice(0, 4000));
      }
    } catch {
      sessionStorage.removeItem(CREATION_DRAFT_KEY);
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    setDraftSaved(false);
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(CREATION_DRAFT_KEY, JSON.stringify({ type, brief }));
        setDraftSaved(true);
      } catch {
        setDraftSaved(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [brief, draftReady, type]);

  const startCreation = () => {
    const prompt = brief.trim()
      ? `创作类型：${PROJECT_TYPES.find((item) => item.id === type)?.label}\n故事梗概：${brief.trim()}`
      : `创作类型：${PROJECT_TYPES.find((item) => item.id === type)?.label}`;
    void create({ prompt, destination: "storyboard" });
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-8 sm:px-8 lg:px-12">
      <header className="max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">AID 创作流程</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">从故事到成片</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">把剧本、角色、场景、分镜和视频放在同一个项目里，按步骤完成创作。</p>
      </header>

      <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="创作步骤">
        {FLOW_STEPS.map(([number, title, description]) => (
          <div key={number} className="rounded-2xl border border-border/60 bg-background/40 p-4">
            <span className="text-xs font-mono text-muted-foreground">{number}</span>
            <h2 className="mt-5 text-sm font-medium">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          </div>
        ))}
      </section>

      <section className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="rounded-2xl border border-border/60 bg-background/40 p-5 sm:p-6">
          <h2 className="text-sm font-medium">新建创作项目</h2>
          <p className="mt-1 text-xs text-muted-foreground">项目创建后可以继续补充剧本、角色和参考素材。</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3" role="group" aria-label="创作类型">
            {PROJECT_TYPES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setType(item.id)}
                aria-pressed={type === item.id}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  type === item.id ? "border-foreground/50 bg-foreground/[0.06]" : "border-border/60 hover:bg-foreground/[0.03]",
                )}
              >
                <span className="text-sm font-medium">{item.label}</span>
                <span className="mt-2 block text-xs leading-5 text-muted-foreground">{item.description}</span>
              </button>
            ))}
          </div>

          <label className="mt-6 block text-xs font-medium" htmlFor="creation-brief">故事梗概（可选）</label>
          <textarea
            id="creation-brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="例如：一个失去记忆的快递员，在雨夜发现每个包裹都藏着一段未来……"
            className="mt-2 min-h-36 w-full resize-y rounded-xl border border-border/60 bg-background/60 p-3 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
            maxLength={4000}
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span role="status" aria-live="polite">{!draftReady ? "正在恢复草稿…" : draftSaved ? "草稿已暂存到当前标签页" : "正在保存草稿…"}</span><span>{brief.length}/4000</span></div>

          <div className="mt-5 flex justify-end">
            <Button type="button" size="lg" onClick={startCreation} disabled={creating}>
              {creating ? "正在创建…" : "开始创作"}
            </Button>
          </div>
        </div>

        <aside className="rounded-2xl border border-border/60 bg-foreground/[0.03] p-5 sm:p-6">
          <h2 className="text-sm font-medium">创作资产会统一保存</h2>
          <ul className="mt-4 space-y-3 text-xs leading-5 text-muted-foreground">
            <li>角色、场景和道具可以作为参考图重复使用。</li>
            <li>分镜图片和视频会自动归档到项目资产。</li>
            <li>失败任务可以在画布和资产库中继续处理。</li>
            <li>模型调用仍遵循当前余额与实际价格规则。</li>
          </ul>
        </aside>
      </section>
    </main>
  );
}
