"use client";

import { AppSelect } from "@/components/ui/app-select";

import dynamic from "next/dynamic";
import { DesktopMcpPanel } from "@/components/desktop-mcp-panel";
import { useCallback, useEffect, useMemo, useRef,useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Blocks,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  Play,
  RotateCcw,
  Save,
  SquareTerminal,
  X,
} from "lucide-react";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
const DiffEditor = dynamic(() => import("@monaco-editor/react").then((module) => module.DiffEditor), { ssr: false });

type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size?: number };
type WorkspaceScript = { name: string; manager: "pnpm" | "npm" | "yarn" };
type WorkspaceApi = {
  getCurrentWorkspace?: () => Promise<{ root: string } | null>;
  selectWorkspace: () => Promise<{ root: string; entries: WorkspaceEntry[] } | null>;
  getWorkspaceTree: () => Promise<WorkspaceEntry[]>;
  readWorkspaceFile: (path: string) => Promise<{ path: string; content: string; size: number }>;
  writeWorkspaceFile: (input: { path: string; content: string }) => Promise<{ path: string; snapshotId: string; bytes: number }>;
  restoreWorkspaceSnapshot: (snapshotId: string) => Promise<{ path: string; restored: boolean }>;
  getWorkspaceGitStatus: () => Promise<string>;
  getWorkspaceGitDiff: (path?: string) => Promise<string>;
  getWorkspaceScripts: () => Promise<WorkspaceScript[]>;
  runWorkspaceScript: (name: string) => Promise<{ runId: string }>;
  cancelWorkspaceScript: (runId: string) => Promise<{ canceled: boolean }>;
  onWorkspaceScriptOutput: (callback: (event: { runId: string; chunk: string }) => void) => () => void;
  onWorkspaceScriptFinished: (callback: (event: { runId: string; ok: boolean; exitCode?: number; message?: string }) => void) => () => void;
};

type WorkspaceFile = { path: string; content: string; savedContent: string; snapshotId: string | null };
type PanelTab = "terminal" | "git" | "mcp";

function workspaceApi() {
  return (window as Window & { electronAPI?: WorkspaceApi }).electronAPI;
}

function extensionLanguage(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    c: "c", cpp: "cpp", cs: "csharp", css: "css", go: "go", html: "html", java: "java",
    js: "javascript", json: "json", jsx: "javascript", md: "markdown", mjs: "javascript",
    py: "python", rs: "rust", sh: "shell", sql: "sql", ts: "typescript", tsx: "typescript",
    yaml: "yaml", yml: "yaml",
  };
  return extension ? languages[extension] ?? "plaintext" : "plaintext";
}

function visibleEntries(entries: WorkspaceEntry[], expanded: Set<string>) {
  return entries.filter((entry) => {
    const parts = entry.path.split(/[\\/]/);
    parts.pop();
    let parent = "";
    for (const part of parts) {
      parent = parent ? `${parent}/${part}` : part;
      if (!expanded.has(parent)) return false;
    }
    return true;
  });
}

export function DesktopWorkbench() {
  const api = workspaceApi();
  const [root, setRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [scripts, setScripts] = useState<WorkspaceScript[]>([]);
  const [gitStatus, setGitStatus] = useState("");
  const [gitDiff, setGitDiff] = useState("");
  const [panel, setPanel] = useState<PanelTab>("terminal");
  const [output, setOutput] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRequest=useRef(0);
  const visible = useMemo(() => visibleEntries(entries, expanded), [entries, expanded]);
  const dirty = Boolean(file && file.content !== file.savedContent);

  useEffect(() => {
    let mounted = true;
    void api?.getCurrentWorkspace?.().then(async current => {
      if (!current || !mounted) return;
      setRoot(current.root);
      const tree = await api.getWorkspaceTree();
      if (mounted) setEntries(tree);
    }).catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : "工作区恢复失败，请重新选择。"); });
    return () => { mounted = false; };
  }, [api]);

  const refreshProject = useCallback(async () => {
    if (!api) return;
    const [nextEntries, nextScripts, nextGit] = await Promise.all([
      api.getWorkspaceTree(), api.getWorkspaceScripts(), api.getWorkspaceGitStatus().catch(() => "当前目录未初始化 Git。"),
    ]);
    setEntries(nextEntries);
    setScripts(nextScripts);
    setGitStatus(nextGit);
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const stopOutput = api.onWorkspaceScriptOutput((event) => {
      if (event.runId === runId) setOutput((current) => `${current}${event.chunk}`.slice(-256_000));
    });
    const stopFinished = api.onWorkspaceScriptFinished((event) => {
      if (event.runId !== runId) return;
      setRunId(null);
      setOutput((current) => `${current}\n${event.ok ? `已退出，退出码 ${event.exitCode ?? 0}。` : event.message ?? "脚本执行失败。"}\n`);
      void refreshProject().catch(cause=>setError(cause instanceof Error?cause.message:"项目状态刷新失败，请重试。"));
    });
    return () => { stopOutput(); stopFinished(); };
  }, [api, refreshProject, runId]);

  async function chooseWorkspace() {
    if (!api) return;
    if (dirty && !window.confirm("当前文件有未保存修改。切换项目会丢弃编辑器中的改动，继续吗？")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const selected = await api.selectWorkspace();
      if (!selected) return;
      setRoot(selected.root);
      setEntries(selected.entries);
      setExpanded(new Set(selected.entries.filter((entry) => entry.kind === "directory" && !entry.path.includes("/") && !entry.path.includes("\\")).map((entry) => entry.path)));
      setFile(null); setShowDiff(false); setGitDiff("");
      await refreshProject();
      setNotice("项目目录已授权给本桌面会话。Agent 只能通过工作区接口访问此目录。 ");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法打开项目目录。"); }
    finally { setBusy(false); }
  }

  async function openFile(path: string) {
    if (!api||busy) return;
    if (dirty && !window.confirm("当前文件有未保存修改。继续打开其他文件？")) return;
    setError(null); setShowDiff(false);
    const request=++fileRequest.current;
    try {
      const opened = await api.readWorkspaceFile(path);
      if(request!==fileRequest.current)return;
      setFile({ ...opened, savedContent: opened.content, snapshotId: null });
      setPanel("terminal");
    } catch (cause) { if(request===fileRequest.current)setError(cause instanceof Error ? cause.message : "无法打开文件。"); }
  }

  async function saveFile() {
    if (!api || !file || !dirty || busy) return;
    setBusy(true); setError(null);
    const submitted=file;
    try {
      const saved = await api.writeWorkspaceFile({ path: submitted.path, content: submitted.content });
      setFile((current) => current?.path===submitted.path ? { ...current, savedContent: submitted.content, snapshotId: saved.snapshotId } : current);
      setNotice(`已保存。恢复点 ${saved.snapshotId.slice(0, 8)} 已保存在 Helstera 应用数据目录。`);
      await refreshProject();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); }
    finally { setBusy(false); }
  }

  async function restoreFile() {
    if (!api || !file?.snapshotId || busy) return;
    if (!window.confirm(`将 ${file.path} 恢复到上次保存前的版本？`)) return;
    setBusy(true); setError(null);
    try {
      await api.restoreWorkspaceSnapshot(file.snapshotId);
      const opened = await api.readWorkspaceFile(file.path);
      setFile({ ...opened, savedContent: opened.content, snapshotId: null });
      setNotice("已恢复文件快照。");
      await refreshProject();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "恢复快照失败。"); }
    finally { setBusy(false); }
  }

  async function refreshGit() {
    if (!api) return;
    setError(null);
    try { setGitStatus(await api.getWorkspaceGitStatus()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Git 状态读取失败。"); }
  }

  async function inspectGitDiff() {
    if (!api) return;
    setPanel("git"); setError(null);
    try { setGitDiff(await api.getWorkspaceGitDiff(file?.path)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Git diff 读取失败。"); }
  }

  async function runScript(name: string) {
    if (!api || runId) return;
    setPanel("terminal"); setOutput(`$ 执行脚本: ${name}\n`); setError(null);
    try { setRunId((await api.runWorkspaceScript(name)).runId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "脚本启动失败。"); }
  }

  async function cancelScript() {
    if (!api || !runId) return;
    try{await api.cancelWorkspaceScript(runId);setOutput((current) => `${current}\n已请求停止，正在等待脚本退出。\n`);}
    catch(cause){setError(cause instanceof Error?cause.message:"停止请求失败，请重试。");}
  }

  if (!api) return <main className="desktop-workbench-unavailable"><h1>桌面工作台需要 Helstera Desktop</h1><p>本页面的本地文件与 Git 功能不会在普通浏览器中启用。</p></main>;

  return (
    <main className="local-workbench" aria-label="Helstera 本地开发工作台">
      <header className="local-workbench__toolbar">
        <div className="local-workbench__project"><Braces aria-hidden="true" /><span>{root ? root.split(/[\\/]/).filter(Boolean).at(-1) : "未打开项目"}</span>{file && dirty ? <i aria-label="有未保存修改" /> : null}</div>
        <div className="local-workbench__actions">
          <button type="button" onClick={() => void chooseWorkspace()} disabled={busy || Boolean(runId)}><FolderOpen aria-hidden="true" />打开项目</button>
          <button type="button" onClick={() => void saveFile()} disabled={!dirty || busy}><Save aria-hidden="true" />保存</button>
          <button type="button" onClick={() => void inspectGitDiff()} disabled={!root}><GitBranch aria-hidden="true" />差异</button>
          {scripts.length ? <AppSelect aria-label="运行项目测试或构建" disabled={!root || Boolean(runId)} value="" onChange={(event) => { if (event.target.value) void runScript(event.target.value); }}><option value="">运行脚本</option>{scripts.map((script) => <option key={script.name} value={script.name}>{script.name}</option>)}</AppSelect> : null}
        </div>
      </header>

      <div className="local-workbench__body">
        <aside className="local-workbench__explorer" aria-label="项目文件">
          <div className="local-workbench__pane-title"><span>资源管理器</span><button type="button" onClick={() => void chooseWorkspace()} aria-label="打开项目目录"><FolderOpen aria-hidden="true" /></button></div>
          {!root ? <div className="local-workbench__empty"><FolderOpen aria-hidden="true" /><p>选择一个本地项目目录。</p><button type="button" onClick={() => void chooseWorkspace()}>打开文件夹</button></div> : (
            <div className="local-workbench__tree">{visible.map((entry) => {
              const depth = entry.path.split(/[\\/]/).length - 1;
              const isOpen = expanded.has(entry.path);
              return <button key={entry.path} type="button" className={`local-workbench__tree-item ${file?.path === entry.path ? "is-selected" : ""}`} style={{ paddingInlineStart: `${10 + depth * 14}px` }} onClick={() => entry.kind === "directory" ? setExpanded((current) => { const next = new Set(current); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next; }) : void openFile(entry.path)} title={entry.path}>
                {entry.kind === "directory" ? isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" /> : <FileCode2 aria-hidden="true" />}
                <span>{entry.kind === "directory" ? <Folder aria-hidden="true" /> : null}{entry.name}</span>
              </button>;
            })}</div>
          )}
        </aside>

        <section className="local-workbench__editor" aria-label="代码编辑器">
          <div className="local-workbench__tabbar">{file ? <div className="local-workbench__file-tab"><FileCode2 aria-hidden="true" />{file.path}{dirty ? " •" : ""}<button type="button" onClick={() => { if (!dirty || window.confirm("丢弃未保存修改？")) setFile(null); }} aria-label="关闭文件"><X aria-hidden="true" /></button></div> : <span className="local-workbench__tab-empty">{root ? "从资源管理器打开一个文件" : "工作区"}</span>}</div>
          {file ? showDiff ? <DiffEditor height="100%" language={extensionLanguage(file.path)} original={file.savedContent} modified={file.content} theme="vs-dark" options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: true, automaticLayout: true }} /> : <Editor height="100%" path={file.path} language={extensionLanguage(file.path)} value={file.content} onChange={(value) => setFile((current) => current ? { ...current, content: value ?? "" } : current)} theme="vs-dark" options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "off", tabSize: 2 }} /> : <div className="local-workbench__welcome"><Braces aria-hidden="true" /><h1>{root ? "本地代码工作区" : "打开本地项目"}</h1><p>{root ? "选择左侧文件开始编辑；保存前会创建可恢复快照。" : "项目内容保留在本机，只把 Agent 实际读取的代码片段发送给当前聊天模型。"}</p>{root ? null : <button type="button" onClick={() => void chooseWorkspace()}><FolderOpen aria-hidden="true" />选择项目目录</button>}</div>}
          <div className="local-workbench__status"><span>{root ? root : "未授权本地项目"}</span><span>{file ? `${extensionLanguage(file.path)}${dirty ? " · 未保存" : ""}` : "Helstera Desktop"}</span></div>
        </section>
      </div>

      <section className={`local-workbench__bottom ${panel === "mcp" ? "is-mcp" : ""}`} aria-label="终端、Git 和 MCP 服务">
        <div className="local-workbench__bottom-tabs"><button type="button" className={panel === "terminal" ? "is-active" : ""} onClick={() => setPanel("terminal")}><SquareTerminal aria-hidden="true" />脚本输出</button><button type="button" className={panel === "git" ? "is-active" : ""} onClick={() => { setPanel("git"); void refreshGit(); }}><GitBranch aria-hidden="true" />Git</button><button type="button" className={panel === "mcp" ? "is-active" : ""} onClick={() => setPanel("mcp")}><Blocks aria-hidden="true" />MCP</button><span>{panel === "git" ? <button type="button" onClick={() => void inspectGitDiff()} disabled={!root}>查看当前文件差异</button> : panel === "terminal" && runId ? <button type="button" onClick={() => void cancelScript()}>取消运行</button> : null}</span></div>
        {panel === "mcp" ? <DesktopMcpPanel /> : <pre className="local-workbench__output">{panel === "git" ? gitDiff || gitStatus || "选择项目后读取 Git 状态。" : output || "项目脚本输出会显示在这里。"}</pre>}
      </section>

      <div className="local-workbench__feedback" aria-live="polite">{error ? <span className="is-error"><CircleAlert aria-hidden="true" />{error}</span> : notice ? <span><Check aria-hidden="true" />{notice}</span> : <span>{root ? "工作区访问遵循本机配置，操作仍需任务审批。" : "未选择本地目录；Agent 当前不能读取或修改本机项目。"}</span>}</div>
    </main>
  );
}
