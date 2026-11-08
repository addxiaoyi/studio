"use client";
import {
  WORKFLOW_LABELS,
  connectionIssue,
  type WorkflowGraph,
  type WorkflowNode,
} from "@helstera/shared";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
type Props = {
  node: WorkflowNode;
  graph: WorkflowGraph;
  disabled: boolean;
  onChange(node: WorkflowNode): void;
  onConnect(source: string, target: string): void;
  onDisconnect(id: string): void;
  onDelete(id: string): void;
};
export function NodeInspector({
  node,
  graph,
  disabled,
  onChange,
  onConnect,
  onDisconnect,
  onDelete,
}: Props) {
  const config = node.config;
  const field = "workflow-field";
  return (
    <section className="workflow-inspector" aria-label="节点设置">
      <div className="mb-4">
        <p className="text-xs text-muted-foreground">节点设置</p>
        <h3 className="mt-1 text-base font-semibold">
          {WORKFLOW_LABELS[config.kind]}
        </h3>
      </div>
      <label>
        节点名称
        <input
          className={field}
          value={node.title}
          maxLength={100}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...node,
              title: event.target.value || WORKFLOW_LABELS[config.kind],
            })
          }
        />
      </label>
      {config.kind === "url" && (
        <label>
          目标网址
          <input
            className={field}
            type="url"
            placeholder="https://example.com"
            value={config.url}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...node,
                config: { ...config, url: event.target.value },
              })
            }
          />
        </label>
      )}
      {config.kind === "search" && (
        <label>
          搜索主题
          <textarea
            className={field}
            rows={3}
            value={config.query}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...node,
                config: { ...config, query: event.target.value },
              })
            }
          />
        </label>
      )}
      {config.kind === "capture" && (
        <>
          <label className="!flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.record}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  config: { ...config, record: event.target.checked },
                })
              }
            />
            录制视频
          </label>
          <label>
            最多浏览页数
            <input
              className={field}
              type="number"
              min={1}
              max={5}
              value={config.pageLimit}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...node,
                  config: {
                    ...config,
                    pageLimit: Math.max(
                      1,
                      Math.min(5, Number(event.target.value)),
                    ),
                  },
                })
              }
            />
          </label>
          <p className="text-xs text-muted-foreground">
            仅访问公开网页。录制时会显示绑定网址与参数的确认卡。
          </p>
        </>
      )}
      {config.kind === "trim" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label>
              开始秒数
              <input
                className={field}
                type="number"
                min={0}
                max={7200}
                step={0.1}
                value={config.start}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...node,
                    config: { ...config, start: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label>
              结束秒数
              <input
                className={field}
                type="number"
                min={0}
                max={7200}
                step={0.1}
                value={config.end}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...node,
                    config: { ...config, end: Number(event.target.value) },
                  })
                }
              />
            </label>
          </div>
          <label>
            画幅
            <StyledSelect
              aria-label="裁剪画幅"
              value={config.aspect}
              onChange={(value) =>
                onChange({
                  ...node,
                  config: { ...config, aspect: value as typeof config.aspect },
                })
              }
              disabled={disabled}
              options={[
                { value: "original", label: "保留原画幅" },
                { value: "portrait", label: "竖屏 9:16" },
                { value: "landscape", label: "横屏 16:9" },
              ]}
            />
          </label>
        </>
      )}
      {config.kind === "deliver" && (
        <p className="text-sm text-muted-foreground">
          把输入节点的截图、录像或成片保存到当前画布。关联对话时同时回写结果。
        </p>
      )}
      {config.kind === "asset" && <p className="text-sm text-muted-foreground">直接引用当前画布中的{config.mediaType === "video" ? "视频" : "图片"}。运行时重新验证素材权限和有效期；删除原素材后将停止执行。</p>}
      <div className="mt-5 border-t pt-4">
        <h4 className="text-xs font-semibold">输入连接</h4>
        <ul className="mt-2 space-y-2">
          {graph.edges
            .filter((edge) => edge.target === node.id)
            .map((edge) => (
              <li
                key={edge.id}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span>
                  {
                    graph.nodes.find((source) => source.id === edge.source)
                      ?.title
                  }
                </span>
                <button
                  disabled={disabled}
                  onClick={() => onDisconnect(edge.id)}
                  className="min-h-8 rounded px-2 text-muted-foreground hover:bg-muted"
                  aria-label={`断开${edge.source}到${node.id}`}
                >
                  断开
                </button>
              </li>
            ))}
        </ul>
        {!disabled &&
          graph.nodes.some(
            (source) => !connectionIssue(graph, source.id, node.id),
          ) && (
            <StyledSelect
              aria-label="连接上游节点"
              value=""
              onChange={(source) => onConnect(source, node.id)}
              options={[
                { value: "", label: "选择上游节点…" },
                ...graph.nodes
                  .filter(
                    (source) => !connectionIssue(graph, source.id, node.id),
                  )
                  .map((source) => ({ value: source.id, label: source.title })),
              ]}
            />
          )}
        <p className="mt-2 text-xs text-muted-foreground">
          也可使用画布箭头工具（A），从源节点边缘连到目标节点边缘。
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onDelete(node.id)}
        className="mt-5 w-full text-destructive"
      >
        删除此节点
      </Button>
    </section>
  );
}
