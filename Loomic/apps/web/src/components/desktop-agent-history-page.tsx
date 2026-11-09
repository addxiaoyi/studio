"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {History,RefreshCw} from "lucide-react";
import {useAuth} from "@/lib/auth-context";
import {useTaskHistory} from "@/hooks/use-task-history";
import {DesktopAgentProgressCard} from "@/components/chat/desktop-agent-progress-card";
import {StyledSelect} from "@/components/ui/styled-select";
const modes:Record<string,string>={automatic:"自动选择",isolated_browser:"隔离浏览器",connected_browser_tab:"授权浏览器标签",windows_ui:"本机控件树",visual_ocr:"视觉 / OCR"};
const states:Record<string,string>={queued:"等待执行",running:"执行中",succeeded:"已完成",failed:"失败待处理",canceled:"已取消"};
const roles:Record<string,string>={operator:"操作",researcher:"研究",designer:"设计",editor:"编辑",developer:"开发"};
export function DesktopAgentHistoryPage(){
  const {session}=useAuth();
  const {tasks,loading,error,load}=useTaskHistory(session?.access_token);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [query,setQuery]=useState("");const [filter,setFilter]=useState("all");
  const visible=tasks.filter(task=>(filter==="all"||task.status===filter)&&task.goal.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected=visible.find(task=>task.taskId===selectedId)??visible[0]??null;
  useEffect(()=>{setSelectedId(null);},[session?.user.id]);
  return <main className="desktop-agent-history">
    <header><div><p>工作区 / 执行记录</p><h1>Agent 任务历史</h1><span>核对计划、执行证据和结果，继续未完成的工作</span></div><button type="button" onClick={()=>void load()} disabled={loading}><RefreshCw aria-hidden="true"/>{loading?"正在刷新…":"刷新记录"}</button></header>
    <div className="desktop-agent-history__tools"><input type="search" aria-label="搜索任务目标" placeholder="搜索任务目标…" value={query} onChange={event=>setQuery(event.target.value)}/><StyledSelect aria-label="筛选任务状态" value={filter} onChange={setFilter} options={[{value:"all",label:"全部状态"},...Object.entries(states).map(([value,label])=>({value,label}))]}/><span className="text-xs text-muted-foreground">{visible.length} 条记录</span></div>
    {error&&<div role="alert" className="desktop-agent-history__error desktop-agent-history__retry"><p>{error}</p><button type="button" disabled={loading} onClick={()=>void load()}>重新加载</button></div>}
    <div className="desktop-agent-history__body"><nav aria-label="Agent 任务列表" aria-busy={loading}>{loading&&!tasks.length?<p className="desktop-agent-history__empty" role="status">正在加载任务…</p>:!visible.length?<div className="desktop-agent-history__empty"><History aria-hidden="true"/><p>{query||filter!=="all"?"没有符合筛选条件的任务":"还没有 Agent 任务"}</p>{query||filter!=="all"?<button type="button" onClick={()=>{setQuery("");setFilter("all");}}>清除筛选</button>:<Link href="/home/">回到工作台开始</Link>}</div>:visible.map(task=><button key={task.taskId} type="button" aria-current={selected?.taskId===task.taskId?"true":undefined} onClick={()=>setSelectedId(task.taskId)}><strong>{task.goal}</strong><span>{modes[task.executionMode??"automatic"]??"本机任务"} · {roles[task.role]??"Agent"}</span><small>{states[task.status]??"状态待确认"} · {new Date(task.createdAt).toLocaleString()}</small></button>)}</nav><section aria-label="任务详情">{selected?<DesktopAgentProgressCard key={selected.taskId} taskId={selected.taskId}/>:<p className="desktop-agent-history__empty">选择任务后，这里会显示步骤、审批与结果。</p>}</section></div>
  </main>;
}
