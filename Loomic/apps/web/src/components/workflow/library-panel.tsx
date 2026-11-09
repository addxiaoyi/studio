"use client";
import {productLabel} from "@/lib/product-label";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Save, Search, Undo2 } from "lucide-react";
import {
  CREATIVE_PROMPTS,
  creativeWorkflow,
  instantiateWorkflow,
  portableWorkflow,
  type CreativeLibraryEntry,
  type WorkflowGraph,
} from "@helstera/shared";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import {
  listCreativeLibrary,
  saveCreativeLibrary,
  archiveCreativeLibrary,
} from "@/lib/canvas-workflow-api";

type Props = {
  token: string;
  canvasId: string;
  graph: WorkflowGraph | null;
  selectedIds: string[];
  prompt: string;
  disabled: boolean;
  initialMode?: "workflow" | "prompt";
  onInsert(graph: WorkflowGraph): void;
  onPrompt(prompt: string, append: boolean): void;
};
export function WorkflowLibrary({
  token,
  canvasId,
  graph,
  selectedIds,
  prompt,
  disabled,
  onInsert,
  onPrompt,
  initialMode = "workflow",
}: Props) {
  const [entries, setEntries] = useState<CreativeLibraryEntry[]>([]),
    [query, setQuery] = useState("");
  const [mode, setMode] = useState<"workflow" | "prompt">(initialMode),
    [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const [editing, setEditing] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [scope, setScope] = useState("all"),
    [notice, setNotice] = useState(""),
    [archived, setArchived] = useState<CreativeLibraryEntry | null>(null);
  const [retry, setRetry] = useState(0);
  const requestKey = useRef(crypto.randomUUID());
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void listCreativeLibrary(token, canvasId)
      .then((items) => {
        if (alive) setEntries(items);
      })
      .catch((cause) => {
        if (alive) setError(cause.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canvasId, retry]);
  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "workflow" && !graph)
        throw new Error("先建立一个流程，再保存为模板。");
      const body =
        mode === "workflow"
          ? {
              kind: "workflow" as const,
              graph: portableWorkflow(
                graph!,
                scope === "selection" ? selectedIds : undefined,
              ),
            }
          : { kind: "prompt" as const, prompt };
      const entry = await saveCreativeLibrary(token, canvasId, {
        name: name.trim(),
        description: description.trim(),
        body,
        requestKey: requestKey.current,
      });
      setEntries((items) => [
        entry,
        ...items.filter((item) => item.id !== entry.id),
      ]);
      setEditing(false);
      setName("");
      setDescription("");
      requestKey.current = crypto.randomUUID();
      setNotice("已保存到个人资源库，可在同一工作区的其他画布使用。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const archive = async (entry: CreativeLibraryEntry, restore = false) => {
    setBusy(true);
    setError("");
    try {
      await archiveCreativeLibrary(token, canvasId, entry.id, restore);
      if (restore) {
        setEntries((items) => [entry, ...items]);
        setArchived(null);
      } else {
        setEntries((items) => items.filter((item) => item.id !== entry.id));
        setArchived(entry);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "资源操作失败。");
    } finally {
      setBusy(false);
    }
  };
  const matches = (name: string, description: string) =>
    `${name} ${description}`.toLowerCase().includes(query.trim().toLowerCase());
  const personal = entries.filter(
    (entry) =>
      entry.body.kind === mode && matches(entry.name, entry.description),
  );
  return (
    <section className="workflow-library" aria-label="创作资源库">
      <header>
        <BookOpen size={17} />
        <div>
          <h3>创作资源库</h3>
          <p>保存好用的方法，下次直接开始</p>
        </div>
      </header>
      <div className="workflow-library-tabs">
        <button
          aria-pressed={mode === "workflow"}
          onClick={() => {
            setMode("workflow");
            setEditing(false);
          }}
        >
          流程模板
        </button>
        <button
          aria-pressed={mode === "prompt"}
          onClick={() => {
            setMode("prompt");
            setEditing(false);
          }}
        >
          提示词
        </button>
      </div>
      <label className="workflow-library-search">
        <Search size={14} />
        <input
          aria-label="搜索创作资源"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按名称或用途搜索"
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        disabled={
          busy || disabled || (mode === "workflow" ? !graph : !prompt.trim())
        }
        onClick={() => {
          setEditing((value) => !value);
          setName(mode === "workflow" ? (graph?.title ?? "") : "我的提示词");
          requestKey.current = crypto.randomUUID();
        }}
      >
        <Save size={14} />
        {mode === "workflow" ? "保存当前流程 / 选区" : "保存当前提示词"}
      </Button>
      {editing && (
        <form
          className="workflow-library-save"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            资源名称
            <input
              className="workflow-field"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label>
            用途说明
            <textarea
              className="workflow-field"
              maxLength={300}
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {mode === "workflow" ? (
            <>
              <StyledSelect
                aria-label="模板保存范围"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "all", label: "完整流程" },
                  ...(selectedIds.length
                    ? [
                        {
                          value: "selection",
                          label: `所选 ${selectedIds.length} 个节点`,
                        },
                      ]
                    : []),
                ]}
              />
              <p>
                只对你可见。保留节点参数和文字，私有素材绑定会清空，使用时重新选择。
              </p>
            </>
          ) : (
            <p className="workflow-library-prompt">{prompt}</p>
          )}
          <Button size="sm" type="submit" disabled={busy || !name.trim()}>
            保存到个人库
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
          <button
            className="ml-2 underline"
            onClick={() => {
              setError("");
              setRetry((value) => value + 1);
            }}
          >
            重试
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {archived && (
        <div role="status" className="workflow-library-undo">
          已移除“{archived.name}”
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void archive(archived, true)}
          >
            <Undo2 size={13} />
            撤销移除
          </Button>
        </div>
      )}
      <h4>推荐{mode === "workflow" ? "流程" : "提示词"}</h4>
      {mode === "workflow"
        ? (["script", "storyboard", "film"] as const).map((id) => {
            const template = creativeWorkflow(id);
            return matches(template.title, "") ? (
              <article key={id}>
                <h5>{productLabel(template.title)}</h5>
                <p>{template.nodes.length} 个节点 · 参数可编辑</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    onInsert(instantiateWorkflow(template, crypto.randomUUID()))
                  }
                >
                  插入画布草稿
                </Button>
              </article>
            ) : null;
          })
        : CREATIVE_PROMPTS.filter((item) =>
            matches(item.name, item.description),
          ).map((item) => (
            <article key={item.id}>
              <h5>{item.name}</h5>
              <p>{item.description}</p>
              <details>
                <summary>查看提示词</summary>
                <p className="workflow-library-prompt">{item.prompt}</p>
              </details>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onPrompt(item.prompt, true)}
                >
                  追加到当前输入
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onPrompt(item.prompt, false)}
                >
                  替换当前输入
                </Button>
              </div>
            </article>
          ))}
      <h4>我的{mode === "workflow" ? "模板" : "提示词"}</h4>
      {loading ? (
        <p role="status">正在加载个人资源…</p>
      ) : !personal.length ? (
        <p className="text-xs text-muted-foreground">
          {query
            ? "没有匹配的个人资源。"
            : "保存当前流程或提示词，即可在这里复用。"}
        </p>
      ) : (
        personal.map((entry) => (
          <article key={entry.id}>
            <h5>{productLabel(entry.name)}</h5>
            <p>{entry.description || "个人保存的创作资源"}</p>
            {entry.body.kind === "workflow" ? (
              <>
                <p>
                  {entry.body.graph.nodes.length} 个节点 ·{" "}
                  {entry.body.graph.edges.length} 条连接
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    if (entry.body.kind === "workflow")
                      onInsert(
                        instantiateWorkflow(
                          entry.body.graph,
                          crypto.randomUUID(),
                        ),
                      );
                  }}
                >
                  插入画布草稿
                </Button>
              </>
            ) : (
              <>
                <p className="workflow-library-prompt">{entry.body.prompt}</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    if (entry.body.kind === "prompt")
                      onPrompt(entry.body.prompt, true);
                  }}
                >
                  追加到当前输入
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    if (entry.body.kind === "prompt")
                      onPrompt(entry.body.prompt, false);
                  }}
                >
                  替换当前输入
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void archive(entry)}
            >
              移除
            </Button>
          </article>
        ))
      )}
    </section>
  );
}
