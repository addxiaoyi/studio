"use client";

import { useState } from "react";
import { Grid2X2, Moon, PanelsTopLeft, Shirt, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { FashionWorkspace } from "@/components/fashion-workspace";
import { LegacyFashionGallery } from "@/components/legacy-fashion-gallery";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function FashionGalleryPage() {
  const [canvasMode, setCanvasMode] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const openWorkspace = () => setCanvasMode(false);
  const openCanvas = () => setCanvasMode(true);
  const toggleTheme = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");
  const modeClass = (active: boolean) => cn("inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", active ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground");

  return <div className="min-h-full bg-background text-foreground">
    <header className="border-b border-border px-4 pb-4 pt-6 sm:px-8">
      <div className="flex items-start gap-3 pr-24">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card"><Shirt className="size-[18px]" aria-hidden="true" /></div>
        <div><h1 className="text-xl font-semibold tracking-tight">女装试穿</h1><p className="mt-1 text-xs leading-relaxed text-muted-foreground">从穿搭灵感到你的试穿效果</p></div>
      </div>
      <div className="mt-5 flex items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-1" aria-label="试穿方式">
          <button type="button" aria-pressed={!canvasMode} onClick={openWorkspace} className={modeClass(!canvasMode)}><Grid2X2 className="size-3.5" aria-hidden="true" />试穿工作台</button>
          <button type="button" aria-pressed={canvasMode} onClick={openCanvas} className={modeClass(canvasMode)}><PanelsTopLeft className="size-3.5" aria-hidden="true" />画布试穿</button>
        </nav>
        <Button type="button" variant="ghost" size="icon" onClick={toggleTheme} aria-label={resolvedTheme === "dark" ? "切换为浅色主题" : "切换为深色主题"} title="切换主题">{resolvedTheme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</Button>
      </div>
    </header>
    <div hidden={canvasMode} inert={canvasMode}><FashionWorkspace /></div>
    {canvasMode && <LegacyFashionGallery />}
  </div>;
}
