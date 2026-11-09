"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  Braces,
  Maximize2,
  Play,
  Settings2,
  Sparkles,
  Pin,
} from "lucide-react";
import {
  WORKFLOW_LABELS,
  type AgentGoal,
  type WorkflowGraph,
  type WorkflowNode,
} from "@helstera/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthenticatedRecording } from "@/components/chat/authenticated-recording";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import {
  fetchWorkflowResults,
  type WorkflowResultRun,
} from "@/lib/canvas-workflow-api";
import { workflowStepState } from "./step-state";
import { workflowStateLabel } from "./canvas-node";
import "./node-workbench.css";

type Run = { goalId: string; revision: number; graph: WorkflowGraph };
type Props = {
  node: WorkflowNode;
  graph: WorkflowGraph;
  token: string;
  canvasId: string;
  workflowId: string;
  run: Run | undefined;
  goal: AgentGoal | null;
  dirty: boolean;
  disabled: boolean;
  children: ReactNode;
  onSelect(id: string): void;
  onRun(): void;
  onAsk(): void;
  onRecords(): void;
  onPin(pin:WorkflowNode["pin"]):void;
};
export function NodeWorkbench(props: Props) {
  const [tab, setTab] = useState<"input" | "parameters" | "output">(
      "parameters",
    ),
    [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState<WorkflowResultRun | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const goal = props.goal?.id === props.run?.goalId ? props.goal : null;
  const signature = goal?.executionSteps
    ?.map((step) => `${step.id}:${step.state}:${step.attempt}`)
    .join("|");
  const goalId = props.node.pin?.goalId??props.run?.goalId;
  useEffect(() => {
    let active = true;
    setResults(null);
    setError("");
    setLoading(Boolean(goalId));
    if (goalId)
      void fetchWorkflowResults(
        props.token,
        props.canvasId,
        props.workflowId,
        goalId,
      )
        .then((value) => {
          if (active) setResults(value);
        })
        .catch((cause) => {
          if (active)
            setError(
              cause instanceof Error ? cause.message : "读取节点结果失败。",
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    return () => {
      active = false;
    };
  }, [props.token, props.canvasId, props.workflowId, goalId, signature, retry]);
  const step = goal?.executionSteps?.find(
    (step) => step.stepId === props.node.id,
  );
  const inputs = props.graph.edges
    .filter((edge) => edge.target === props.node.id)
    .map((edge) => props.graph.nodes.find((node) => node.id === edge.source))
    .filter((node): node is WorkflowNode => Boolean(node));
  const canRun = !["url", "search","condition"].includes(props.node.config.kind);
  const record = results?.results.find((item) => item.nodeId === props.node.id);
  const current =
    props.run &&
    !props.dirty &&
    JSON.stringify(
      props.run.graph.nodes.find((node) => node.id === props.node.id)?.config,
    ) === JSON.stringify(props.node.config);
  const preview = (value: WorkflowResultRun["results"][number]) => (
    <div className="node-output-preview">
      {value.text && <MarkdownRenderer text={value.text} />}
      {value.assets.map((asset) =>
        asset.available ? (
          <AuthenticatedRecording
            key={asset.id}
            assetId={asset.id}
            accessToken={props.token}
            kind={asset.mediaType}
            label={value.title}
          />
        ) : (
          <p key={asset.id} role="status">
            素材已到期或不可用，请重新选择。
          </p>
        ),
      )}
      <details>
        <summary>
          <Braces size={13} />
          查看结构化结果
        </summary>
        <pre>
          {JSON.stringify({ text: value.text, assets: value.assets }, null, 2)}
        </pre>
      </details>
    </div>
  );
  const inputView = (
    <section className="node-data-pane" aria-label="节点输入">
      <h3>
        <ArrowDownToLine size={15} />
        输入来源 <span>{inputs.length}</span>
      </h3>
      {!inputs.length && (
        <p className="node-data-empty">
          {["url", "text", "asset", "search"].includes(props.node.config.kind)
            ? "起始节点使用自身参数，无需上游输入。"
            : "还没有输入。连接上游节点后，可在这里查看来源和结果。"}
        </p>
      )}
      {inputs.map((input) => {
        const value = results?.results.find((item) => item.nodeId === input.id);
        return (
          <article key={input.id}>
            <button
              className="node-source-link"
              type="button"
              onClick={() => props.onSelect(input.id)}
            >
              {input.title}
              <small>{WORKFLOW_LABELS[input.config.kind]}</small>
            </button>
            {input.config.kind === "url" ? (
              <p className="node-static-value">
                {input.config.url || "网址未填写"}
              </p>
            ) : input.config.kind === "text" ? (
              <div className="node-static-value">
                <MarkdownRenderer text={input.config.text || "内容未填写"} />
              </div>
            ) : value ? (
              preview(value)
            ) : (
              <p className="node-data-empty">
                尚无成功结果；运行到此节点时会先执行该来源。
              </p>
            )}
          </article>
        );
      })}
      {results && inputs.length > 0 && (
        <p className="node-data-caption">
          结果来自第 {results.revision} 版运行。执行时使用本次上游的实际输出。
        </p>
      )}
    </section>
  );
  const outputView = (
    <section className="node-data-pane" aria-label="节点输出">
      {props.node.pin?<div className="workflow-pin-notice"><strong><Pin size={13}/>已固定成功结果</strong><p>后续运行复用这份回执，上游不会重复生成。参数锁定，素材失效时会停止。</p><Button size="sm" variant="outline" disabled={props.disabled} onClick={()=>props.onPin(undefined)}>取消固定</Button></div>:record&&props.run&&!props.dirty&&canRun&&!["deliver","delay"].includes(props.node.config.kind)&&<Button size="sm" variant="outline" disabled={props.disabled} onClick={()=>props.onPin({goalId:props.run!.goalId,nodeId:props.node.id})}><Pin size={13}/>固定此结果</Button>}
      <h3>
        输出结果{" "}
        <span>
              {props.node.pin?"已固定":step ? workflowStateLabel[workflowStepState(step)] : "尚未执行"}
        </span>
      </h3>
      {props.run && (
        <p className="node-data-caption">
          第 {props.run.revision} 版运行
          {current ? "" : " · 历史快照，当前参数可能已改变"}
        </p>
      )}
      {loading ? (
        <p role="status" className="node-data-empty">
          正在读取真实执行结果…
        </p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试读取
          </Button>
        </div>
      ) : record ? (
        preview(record)
      ) : (
        <p className="node-data-empty">
          {step?.state === "failed"
            ? "此节点未成功完成，已完成的上游结果仍保留。"
            : step?.state === "waiting_approval"
              ? "等待确认动作后生成结果。"
              : step?.state === "running"
                ? "正在执行，结果会自动显示。"
                : "尚无结果。可先检查输入和参数，再执行到此节点。"}
        </p>
      )}
      {step?.error && (
        <p role="alert" className="node-data-error">
          {step.error}
        </p>
      )}
      {step && (
        <div className="node-execution-meta">
          <span>尝试 {step.attempt} 次</span>
          <Button size="sm" variant="outline" onClick={props.onRecords}>
            查看审批与执行
          </Button>
        </div>
      )}
    </section>
  );
  const runNode = () => {
      setExpanded(false);
      props.onRun();
    },
    askNode = () => {
      setExpanded(false);
      props.onAsk();
    };
  const controls = (
    <div className="node-workbench-actions">
      <Button
        size="sm"
        disabled={props.disabled || !canRun}
        onClick={runNode}
        title={canRun ? "运行目标及所需上游" : "在下游处理节点执行"}
      >
        <Play size={13} />
        执行到此节点
      </Button>
      <Button size="sm" variant="ghost" onClick={askNode}>
        <Sparkles size={13} />
        AI 修改
      </Button>
    </div>
  );
  return (
    <div className="node-workbench">
      <div className="node-workbench-bar">
        <div role="group" aria-label="节点详情视图">
          <button
            type="button"
            aria-pressed={tab === "input"}
            onClick={() => setTab("input")}
          >
            输入
          </button>
          <button
            type="button"
            aria-pressed={tab === "parameters"}
            onClick={() => setTab("parameters")}
          >
            参数
          </button>
          <button
            type="button"
            aria-pressed={tab === "output"}
            onClick={() => setTab("output")}
          >
            输出
          </button>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="展开节点详情"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={14} />
        </Button>
      </div>
      {controls}
      {!expanded &&
        (tab === "input"
          ? inputView
          : tab === "output"
            ? outputView
            : props.children)}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="node-workbench-dialog">
          <DialogHeader>
            <DialogTitle>{props.node.title}</DialogTitle>
            <DialogDescription>
              {WORKFLOW_LABELS[props.node.config.kind]} ·
              查看输入，编辑参数，核对真实输出
            </DialogDescription>
          </DialogHeader>
          {controls}
          <div className="node-workbench-columns">
            {inputView}
            <section className="node-parameters-pane" aria-label="节点参数">
              <h3>
                <Settings2 size={15} />
                参数
              </h3>
              {expanded && props.children}
            </section>
            {outputView}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
