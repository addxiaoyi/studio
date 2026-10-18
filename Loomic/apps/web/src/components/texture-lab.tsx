"use client";

import { Download, Eraser, Grid2X2, LoaderCircle, Paintbrush, Redo2, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { getModelPricingLabel } from "@/lib/model-pricing";
import { fetchImageModels, generateImageDirect, type ImageModelInfo } from "@/lib/server-api";

type SpriteType = "block" | "item";
type ColorCount = 8 | 16 | 32;

const DEFAULT_PALETTE = ["#1d2a35", "#314b46", "#5b7655", "#a6a15b", "#d6c48a", "#d9825b", "#8f4e52", "#f1e6c8"];
const DRAFT_KEY = "helstera:texture-lab:draft";

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("参考图读取失败"));
    image.src = url;
  });
}

function rgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function nearestColor(red: number, green: number, blue: number, palette: string[]): string {
  let closest = palette[0] ?? "#000000";
  let distance = Number.POSITIVE_INFINITY;
  for (const color of palette) {
    const [r, g, b] = rgb(color);
    const next = (red - r) ** 2 + (green - g) ** 2 + (blue - b) ** 2;
    if (next < distance) {
      closest = color;
      distance = next;
    }
  }
  return closest;
}

function extractPalette(rgba: Uint8ClampedArray, count: number): string[] {
  const bins = new Map<string, { red: number; green: number; blue: number; count: number }>();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if ((rgba[offset + 3] ?? 255) < 80) continue;
    const red = rgba[offset] ?? 0; const green = rgba[offset + 1] ?? 0; const blue = rgba[offset + 2] ?? 0;
    const key = `${red >> 3},${green >> 3},${blue >> 3}`;
    const bin = bins.get(key) ?? { red: 0, green: 0, blue: 0, count: 0 };
    bin.red += red; bin.green += green; bin.blue += blue; bin.count += 1; bins.set(key, bin);
  }
  const centers: Array<[number, number, number]> = [...bins.values()].sort((a, b) => b.count - a.count).slice(0, count).map((bin) => [bin.red / bin.count, bin.green / bin.count, bin.blue / bin.count]);
  for (let pass = 0; pass < 5; pass += 1) {
    const groups = centers.map(() => ({ red: 0, green: 0, blue: 0, count: 0 }));
    for (const bin of bins.values()) {
      const sample = [bin.red / bin.count, bin.green / bin.count, bin.blue / bin.count];
      let closest = 0; let shortest = Number.POSITIVE_INFINITY;
      centers.forEach((center, index) => {
        const distance = 2 * (sample[0]! - center[0]) ** 2 + 4 * (sample[1]! - center[1]) ** 2 + (sample[2]! - center[2]) ** 2;
        if (distance < shortest) { closest = index; shortest = distance; }
      });
      const group = groups[closest];
      if (group) { group.red += bin.red; group.green += bin.green; group.blue += bin.blue; group.count += bin.count; }
    }
    centers.forEach((_, index) => {
      const group = groups[index];
      if (group?.count) centers[index] = [group.red / group.count, group.green / group.count, group.blue / group.count];
    });
  }
  return [...new Set(centers.map((center) => `#${center.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`))];
}

function samplePixels(rgba: Uint8ClampedArray, sourceSize: number, targetSize: number, palette: string[]): string[] {
  return Array.from({ length: targetSize * targetSize }, (_, index) => {
    const x = index % targetSize; const y = Math.floor(index / targetSize);
    const left = Math.floor(x * sourceSize / targetSize); const right = Math.max(left + 1, Math.floor((x + 1) * sourceSize / targetSize));
    const top = Math.floor(y * sourceSize / targetSize); const bottom = Math.max(top + 1, Math.floor((y + 1) * sourceSize / targetSize));
    let red = 0; let green = 0; let blue = 0; let alpha = 0; let count = 0;
    for (let py = top; py < bottom; py += 1) for (let px = left; px < right; px += 1) {
      const offset = (py * sourceSize + px) * 4;
      red += rgba[offset] ?? 0; green += rgba[offset + 1] ?? 0; blue += rgba[offset + 2] ?? 0; alpha += rgba[offset + 3] ?? 255; count += 1;
    }
    if (alpha / Math.max(count, 1) < 80) return "transparent";
    return nearestColor(red / count, green / count, blue / count, palette);
  });
}

function makeSeamless(pixels: string[], size: number, palette: string[]): string[] {
  const next = [...pixels];
  for (let x = 0; x < size; x += 1) {
    const top = rgb(next[x] ?? palette[0] ?? "#000000");
    const bottomIndex = (size - 1) * size + x;
    const bottom = rgb(next[bottomIndex] ?? palette[0] ?? "#000000");
    const color = nearestColor((top[0] + bottom[0]) / 2, (top[1] + bottom[1]) / 2, (top[2] + bottom[2]) / 2, palette);
    next[x] = color;
    next[bottomIndex] = color;
  }
  for (let y = 0; y < size; y += 1) {
    const leftIndex = y * size;
    const rightIndex = leftIndex + size - 1;
    const left = rgb(next[leftIndex] ?? palette[0] ?? "#000000");
    const right = rgb(next[rightIndex] ?? palette[0] ?? "#000000");
    const color = nearestColor((left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2, palette);
    next[leftIndex] = color;
    next[rightIndex] = color;
  }
  return next;
}

function removeItemBackground(pixels: string[], size: number): string[] {
  const source = pixels.map((color) => color === "transparent" ? null : rgb(color));
  const first = source[0];
  if (!first) return pixels;
  const matches = (index: number) => {
    const color = source[index];
    return color && Math.abs(color[0] - first[0]) + Math.abs(color[1] - first[1]) + Math.abs(color[2] - first[2]) < 42;
  };
  const queue = [0];
  const seen = new Set(queue);
  while (queue.length) {
    const index = queue.shift() ?? 0;
    const x = index % size;
    const y = Math.floor(index / size);
    const neighbors = [x > 0 ? index - 1 : -1, x < size - 1 ? index + 1 : -1, y > 0 ? index - size : -1, y < size - 1 ? index + size : -1];
    for (const next of neighbors) {
      if (next >= 0 && !seen.has(next) && matches(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return pixels.map((color, index) => seen.has(index) ? "transparent" : color);
}

export function TextureLab() {
  const { session } = useAuth();
  const [prompt, setPrompt] = useState("a hand-painted mossy stone texture, seamless, clean edges, game-ready pixel art");
  const [size, setSize] = useState(32);
  const [spriteType, setSpriteType] = useState<SpriteType>("block");
const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [colorCount, setColorCount] = useState<ColorCount>(16);
  const [pixels, setPixels] = useState<string[]>(() => Array(32 * 32).fill(DEFAULT_PALETTE[0]));
  const [history, setHistory] = useState<string[][]>([]);
  const [future, setFuture] = useState<string[][]>([]);
  const [selectedColor, setSelectedColor] = useState(DEFAULT_PALETTE[4] ?? "#d6c48a");
  const [erase, setErase] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
 const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [referenceData, setReferenceData] = useState<string | null>(null);
  const [generationModel, setGenerationModel] = useState<ImageModelInfo | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);
 const exportRef = useRef<HTMLCanvasElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);

  const readDraft = () => {
    try {
      return typeof window !== "undefined" ? window.localStorage.getItem(DRAFT_KEY) : null;
    } catch {
      return null;
    }
  };

  const writeDraft = (value: string) => {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(DRAFT_KEY, value);
    } catch {
      // Draft persistence is optional in restricted browser contexts.
    }
  };

  const clearDraft = () => {
    try {
      if (typeof window !== "undefined") window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Draft persistence is optional in restricted browser contexts.
    }
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(readDraft() ?? "null") as {
        prompt?: string; size?: number; spriteType?: SpriteType; palette?: string[]; pixels?: string[]; referenceUrl?: string | null;
      } | null;
      if (saved) {
        if (typeof saved.prompt === "string") setPrompt(saved.prompt);
        if (saved.size === 16 || saved.size === 32 || saved.size === 64) setSize(saved.size);
        if (saved.spriteType === "block" || saved.spriteType === "item") setSpriteType(saved.spriteType);
        if (Array.isArray(saved.palette) && saved.palette.length > 0) setPalette(saved.palette);
        if (Array.isArray(saved.pixels)) setPixels(saved.pixels);
        if (typeof saved.referenceUrl === "string") setReferenceUrl(saved.referenceUrl);
      }
    } catch {
      clearDraft();
    } finally {
      restoredRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!restoredRef.current) return;
    writeDraft(JSON.stringify({ prompt, size, spriteType, palette, pixels, referenceUrl }));
  }, [prompt, size, spriteType, palette, pixels, referenceUrl]);

  useEffect(() => {
    const fallback = palette[0] ?? "#000000";
    setPixels((current) => Array.from({ length: size * size }, (_, index) => current[index] ?? fallback));
  }, [size, palette]);

  useEffect(() => {
    let cancelled = false;
    void fetchImageModels()
      .then(({ models, defaultModel }) => {
        if (cancelled) return;
        const model = models.find((item) => item.accessible !== false)
          ?? models.find((item) => item.id === defaultModel)
          ?? null;
        setGenerationModel(model);
      })
      .catch(() => {
        if (!cancelled) setGenerationModel(null);
      })
      .finally(() => {
        if (!cancelled) setPricingLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const paint = useCallback((index: number) => {
    setPixels((current) => {
      const nextColor = erase ? "transparent" : selectedColor;
      if (current[index] === nextColor) return current;
      setHistory((items) => [...items.slice(-39), current]);
      setFuture([]);
      return current.map((color, cursor) => cursor === index ? nextColor : color);
    });
  }, [erase, selectedColor]);

  const undo = useCallback(() => {
    setHistory((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setFuture((itemsAfterUndo) => [...itemsAfterUndo, pixels]);
      setPixels(previous);
      return items.slice(0, -1);
    });
  }, [pixels]);

  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items.at(-1);
      if (!next) return items;
      setHistory((itemsAfterRedo) => [...itemsAfterRedo, pixels]);
      setPixels(next);
      return items.slice(0, -1);
    });
  }, [pixels]);

  const clearPixels = useCallback(() => {
    setHistory((items) => [...items.slice(-39), pixels]);
    setFuture([]);
    setPixels(Array(size * size).fill("transparent"));
  }, [pixels, size]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  function readReference(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("参考图读取失败"));
      reader.onerror = () => reject(new Error("参考图读取失败"));
      reader.readAsDataURL(file);
    });
  }

  async function quantifyReference(dataUrl: string) {
    const image = await loadImage(dataUrl);
    const source = document.createElement("canvas"); source.width = 128; source.height = 128;
    const context = source.getContext("2d");
    if (!context) throw new Error("无法创建纹理画布");
    context.imageSmoothingEnabled = false; context.drawImage(image, 0, 0, 128, 128);
    const highResolution = context.getImageData(0, 0, 128, 128);
    const generatedPalette = extractPalette(highResolution.data, colorCount);
    let nextPixels = samplePixels(highResolution.data, 128, size, generatedPalette);
    if (spriteType === "item") nextPixels = removeItemBackground(nextPixels, size);
    setHistory((items) => [...items.slice(-39), pixels]); setFuture([]); setPixels(nextPixels);
  }

  async function uploadReference(file: File, action: "quantize" | "generate") {
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) { setError("请上传 8MB 以内的 PNG、JPG 或 WEBP 图片"); return; }
    setError("");
   const dataUrl = await readReference(file);
   setReferenceData(dataUrl); setReferenceUrl(dataUrl);
   if (action === "quantize") await quantifyReference(dataUrl);
   if (action === "generate") await generate(dataUrl);
  }

  async function generate(inputReference = referenceData) {
    const token = session?.access_token;
    if (!token || (!prompt.trim() && !inputReference) || generating) return;
    setGenerating(true);
    setError("");
    try {
      let model = generationModel;
      if (!model) {
        const catalog = await fetchImageModels();
        model = catalog.models.find((item) => item.accessible !== false)
          ?? catalog.models.find((item) => item.id === catalog.defaultModel)
          ?? null;
        setGenerationModel(model);
      }
      if (!model) throw new Error("暂无可用的默认图片模型");
      const description = prompt.trim() || (spriteType === "block" ? "Minecraft block material texture matching the uploaded reference" : "Minecraft inventory item matching the uploaded reference");
      const generationPrompt = spriteType === "block"
        ? `${description}. Minecraft Java Edition resource-pack block texture, ${size}x${size}, unmistakable Minecraft pixel-art style, square UV tile, hard nearest-neighbor pixels, compact clustered shapes, restrained game palette, preserve requested material identity, no painterly strokes, no smooth gradients, no photorealism, no perspective, no scene, seamless edges.`
        : `${description}. Minecraft Java Edition inventory item texture, ${size}x${size} sprite, unmistakable Minecraft item-icon pixel art, one recognizable item only, centered silhouette with transparent background, chunky square pixel clusters, hard pixel edges, restrained game palette, no painterly strokes, no gradients, no photorealism, no perspective, no UI slot, no shadow, no text.`;
      const result = await generateImageDirect(token, generationPrompt, { model: model.id, aspectRatio: "1:1", quality: "hd", ...(inputReference ? { inputImages: [inputReference] } : {}) });
      setReferenceUrl(result.url);
      const image = await loadImage(result.url);
      const source = document.createElement("canvas");
      source.width = 128;
      source.height = 128;
      const context = source.getContext("2d");
      if (!context) throw new Error("无法创建纹理画布");
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, 128, 128);
      const highResolution = context.getImageData(0, 0, 128, 128);
      const generatedPalette = extractPalette(highResolution.data, colorCount);
      let nextPixels = samplePixels(highResolution.data, 128, size, generatedPalette);
      if (spriteType === "item") nextPixels = removeItemBackground(nextPixels, size);
      if (spriteType === "block") nextPixels = makeSeamless(nextPixels, size, palette);
      if (spriteType === "item") nextPixels = removeItemBackground(nextPixels, size);
      setHistory((items) => [...items.slice(-39), pixels]);
      setFuture([]);
      setPixels(nextPixels);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "纹理生成失败，请稍后重试");
    } finally {
      setGenerating(false);
    }
  }

  function exportPng() {
    const canvas = exportRef.current;
    if (!canvas) return;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    pixels.forEach((color, index) => {
      if (color === "transparent") return;
      context.fillStyle = color;
      context.fillRect(index % size, Math.floor(index / size), 1, 1);
    });
    const link = document.createElement("a");
    link.download = `helstera-texture-${size}px.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function exportTileset() {
    const canvas = exportRef.current;
    if (!canvas || spriteType !== "block") return;
    canvas.width = size * 4;
    canvas.height = size * 4;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    for (let tile = 0; tile < 16; tile += 1) {
      const ox = (tile % 4) * size;
      const oy = Math.floor(tile / 4) * size;
      pixels.forEach((color, index) => {
        if (color === "transparent") return;
        context.fillStyle = color;
        const x = index % size;
        const y = Math.floor(index / size);
        context.fillRect(ox + x, oy + y, 1, 1);
      });
    }
    const link = document.createElement("a");
    link.download = `helstera-autotile-${size}px.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="mx-auto grid min-h-full max-w-7xl gap-6 p-6 md:grid-cols-[280px_minmax(0,1fr)] md:p-10">
      <canvas ref={exportRef} className="hidden" />
      <aside className="flex flex-col gap-5 rounded-2xl border border-border/60 bg-card p-5">
        <div><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Texture Maker × Texel Studio</p><h1 className="mt-2 text-2xl font-semibold">纹理工坊</h1><p className="mt-2 text-sm leading-5 text-muted-foreground">用平台默认图片模型生成参考，再逐像素调整为可用于游戏的纹理。</p></div>
       <label className="grid gap-2 text-sm font-medium">描述纹理<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-28 resize-y rounded-xl border border-border/60 bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-foreground/20" /></label>
        <input ref={referenceInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; const action = event.currentTarget.dataset.action === "generate" ? "generate" : "quantize"; if (file) void uploadReference(file, action).catch((cause) => setError(cause instanceof Error ? cause.message : "参考图处理失败")); event.currentTarget.value = ""; }} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { if (referenceInput.current) { referenceInput.current.dataset.action = "quantize"; referenceInput.current.click(); } }} className="h-10 rounded-xl border border-border/60 text-sm">上传并直接量化</button>
          <button type="button" onClick={() => { if (referenceInput.current) { referenceInput.current.dataset.action = "generate"; referenceInput.current.click(); } }} className="h-10 rounded-xl border border-border/60 text-sm">上传参考图</button>
        </div>
        {referenceData ? <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 p-2 text-xs"><span className="truncate">参考图已载入</span><button type="button" className="underline" onClick={() => { setReferenceData(null); setReferenceUrl(null); }}>移除</button></div> : null}
        <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm font-medium">尺寸<select value={size} onChange={(event) => setSize(Number(event.target.value))} className="h-10 rounded-xl border border-border/60 bg-background px-3 text-sm"><option value="16">16 × 16（MC 标准）</option><option value="32">32 × 32</option><option value="64">64 × 64</option></select></label><label className="grid gap-2 text-sm font-medium">类型<select value={spriteType} onChange={(event) => setSpriteType(event.target.value as SpriteType)} className="h-10 rounded-xl border border-border/60 bg-background px-3 text-sm"><option value="block">MC 方块纹理</option><option value="item">MC 物品图标</option></select></label></div>
        <label className="grid gap-2 text-sm font-medium">颜色数量<select value={colorCount} onChange={(event) => setColorCount(Number(event.target.value) as ColorCount)} className="h-10 rounded-xl border border-border/60 bg-background px-3 text-sm"><option value="8">8 色 · 复古像素</option><option value="16">16 色 · Minecraft 推荐</option><option value="32">32 色 · 保留更多细节</option></select></label>
        <div><p className="mb-2 text-sm font-medium">调色板</p><div className="flex flex-wrap gap-2">{palette.map((color) => <button key={color} type="button" title={color} onClick={() => { setSelectedColor(color); setErase(false); }} className="size-7 rounded-md border-2" style={{ backgroundColor: color, borderColor: selectedColor === color && !erase ? "var(--foreground)" : "transparent" }} />)}<button type="button" title="添加颜色" onClick={() => setPalette((current) => [...current, "#ffffff"])} className="size-7 rounded-md border border-dashed border-border text-muted-foreground">+</button></div></div>
        <div className="flex gap-2"><button type="button" onClick={() => setErase((value) => !value)} className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border text-sm ${erase ? "border-foreground bg-foreground text-background" : "border-border/60"}`}><Eraser className="size-4" />橡皮擦</button><button type="button" onClick={clearPixels} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-border/60 text-sm"><Trash2 className="size-4" />清空</button></div>
        <div className="flex gap-2">
          <button type="button" onClick={undo} disabled={history.length === 0} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-border/60 text-xs disabled:opacity-40"><Undo2 className="size-3.5" />撤销</button>
          <button type="button" onClick={redo} disabled={future.length === 0} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-border/60 text-xs disabled:opacity-40"><Redo2 className="size-3.5" />重做</button>
        </div>
        <button type="button" onClick={() => void generate()} disabled={generating || (!prompt.trim() && !referenceData) || pricingLoading} className="inline-flex min-h-11 items-center justify-between gap-3 rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:opacity-40"><span className="inline-flex items-center gap-2">{generating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{generating ? "生成并量化中" : "生成纹理"}</span><span className="text-xs font-normal text-background/70">{pricingLoading ? "读取价格…" : generationModel ? getModelPricingLabel(generationModel, "image").replace(" · 最终售价", "") : "暂无可用模型"}</span></button>
        {generationModel && <p className="-mt-3 text-center text-[11px] text-muted-foreground">使用 {generationModel.displayName} · 扣费前按上方价格确认</p>}
        {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      </aside>
      <section className="flex min-h-[600px] flex-col gap-5 rounded-2xl border border-border/60 bg-card p-5 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-muted-foreground">像素画布</p><p className="mt-1 text-lg font-medium">{size} × {size} · {spriteType === "block" ? "可平铺方块" : "透明物品图标"}</p></div><div className="flex gap-2"><button type="button" onClick={exportPng} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 px-3 text-sm"><Download className="size-4" />导出 PNG</button><button type="button" onClick={exportTileset} disabled={spriteType !== "block"} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 px-3 text-sm disabled:opacity-40"><Grid2X2 className="size-4" />16 格瓦片</button></div></div>
        <div className="flex min-h-[450px] flex-1 items-center justify-center overflow-auto rounded-2xl border border-border/50 bg-[linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(-45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(45deg,transparent_75%,hsl(var(--muted))_75%),linear-gradient(-45deg,transparent_75%,hsl(var(--muted))_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px] p-8"><div className="grid aspect-square w-[min(78vw,560px)] touch-none border border-foreground/20 shadow-2xl" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>{pixels.map((color, index) => <button key={index} type="button" aria-label={`像素 ${index + 1}`} onClick={() => paint(index)} className="aspect-square border-[0.5px] border-black/10" style={{ backgroundColor: color === "transparent" ? "transparent" : color }} />)}</div></div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Paintbrush className="size-4" />点击像素绘制，生成后可继续修改</span><div className="flex items-center gap-3">{referenceUrl && <><img src={referenceUrl} alt="AI 参考图" className="size-10 rounded-md border border-border/60 object-cover" /><a href={referenceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">查看参考图</a></>}</div></div>
      </section>
    </div>
  );
}
