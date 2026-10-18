"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, Search, Sparkles, WandSparkles } from "lucide-react";
import { StyledSelect } from "@/components/ui/styled-select";

type Prompt = { id:string; title:string; prompt:string; category:string; tags:string[]; source?:string; license?:string };
type Category = { category:string; count:number };

export default function PromptsPage() {
  const router = useRouter();
  const picking = useSearchParams().get("pick") === "1";
  const [items,setItems]=useState<Prompt[]>([]);
  const [categories,setCategories]=useState<Category[]>([]);
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [copied,setCopied]=useState("");
  const load=useCallback(async()=>{setLoading(true);setError("");try{const p=new URLSearchParams({limit:"100"});if(query.trim())p.set("q",query.trim());if(category)p.set("category",category);const r=await fetch(`/api/prompts?${p}`,{credentials:"include"});if(!r.ok)throw new Error(`请求失败 (${r.status})`);const v=await r.json();setItems(Array.isArray(v.data)?v.data:[]);setCategories(Array.isArray(v.categories)?v.categories:[])}catch(e){setError(e instanceof Error?e.message:"暂时无法加载提示词")}finally{setLoading(false)}},[query,category]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),200);return()=>window.clearTimeout(timer)},[load]);
  const copy=async(p:Prompt)=>{await navigator.clipboard.writeText(p.prompt);setCopied(p.id);window.setTimeout(()=>setCopied(""),1500)};
  const usePrompt=(p:Prompt)=>{sessionStorage.setItem("helstera_selected_prompt",p.prompt);const back=sessionStorage.getItem("helstera_prompt_return");sessionStorage.removeItem("helstera_prompt_return");if(back)window.location.href=back;else router.push("/canvas")};
  return <main className="mx-auto min-h-full max-w-6xl p-6 md:p-10"><header><p className="text-sm text-muted-foreground">图片、视频与电商创作模板</p><h1 className="mt-1 text-3xl font-semibold">提示词库</h1></header><div className="mt-6 flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-3 size-4 text-muted-foreground"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索标题、内容或标签" className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"/></label><StyledSelect value={category} onChange={setCategory} aria-label="提示词分类" options={[{value:"",label:"全部分类"}, ...categories.map(c=>({value:c.category,label:c.category,note:`${c.count} 条`}))]} /></div>{loading&&<div className="mt-8 text-sm text-muted-foreground">加载中...</div>}{!loading&&error&&<div className="mt-8 rounded-lg border border-destructive/30 p-5 text-sm">{error}</div>}{!loading&&!error&&items.length===0&&<div className="mt-8 flex flex-col items-center rounded-lg border border-dashed p-16"><Sparkles className="size-9 text-muted-foreground"/><p className="mt-3 text-sm">没有匹配的提示词</p></div>}{!loading&&!error&&items.length>0&&<div className="mt-8 grid gap-4 md:grid-cols-2">{items.map(p=><article key={p.id} className="rounded-lg border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-medium">{p.title}</h2><p className="mt-1 text-xs text-muted-foreground">{p.category||"通用"}{p.source?` · ${p.source}`:""}{p.license?` · ${p.license}`:""}</p></div><div className="flex gap-1"><button type="button" aria-label="复制提示词" title="复制提示词" onClick={()=>copy(p)} className="rounded-md p-2 hover:bg-muted">{copied===p.id?<Check className="size-4 text-green-600"/>:<Copy className="size-4"/>}</button><button type="button" aria-label="使用提示词" title="使用提示词" onClick={()=>usePrompt(p)} className="rounded-md bg-foreground p-2 text-background"><WandSparkles className="size-4"/></button></div></div><p className="mt-4 line-clamp-6 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{p.prompt}</p>{p.tags?.length>0&&<div className="mt-4 flex flex-wrap gap-1">{p.tags.slice(0,6).map(tag=><span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{tag}</span>)}</div>}</article>)}</div>}{picking&&<p className="mt-6 text-center text-xs text-muted-foreground">点击魔法棒后返回画布并填入聊天输入框</p>}</main>;
}
