"use client";
import { useMemo, useState } from "react";
import type { WorkflowGraph } from "@helstera/shared";
import { LocateFixed, Search } from "lucide-react";
import "./navigation.css";

export function workflowMapBounds(graph: WorkflowGraph) {
  const nodes = graph.nodes;
  if (!nodes.length) return { x: 0, y: 0, width: 500, height: 300 };
  const x = Math.min(...nodes.map((node) => node.position.x)) - 60;
  const y = Math.min(...nodes.map((node) => node.position.y)) - 60;
  return {
    x,
    y,
    width: Math.max(
      500,
      Math.max(...nodes.map((node) => node.position.x + 300)) - x + 60,
    ),
    height: Math.max(
      300,
      Math.max(...nodes.map((node) => node.position.y + 184)) - y + 60,
    ),
  };
}
export function WorkflowMap({
  graph,
  onLocate,
  highlight = [],
  label = "工作流缩略图",
}: {
  graph: WorkflowGraph;
  onLocate?: (ids: string[]) => void;
  highlight?: string[];
  label?: string;
}) {
  const bounds = workflowMapBounds(graph);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <svg
      className="workflow-minimap"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      // biome-ignore lint/a11y/useSemanticElements: Interactive SVG descendants need a group; HTML fieldsets cannot contain SVG geometry.
      role="group"
      aria-label={label}
    >
      {(graph.groups ?? []).map((group) => {
        const members = graph.nodes.filter((node) =>
          group.nodeIds.includes(node.id),
        );
        if (!members.length) return null;
        const box = workflowMapBounds({ ...graph, nodes: members });
        return (
          <g
            key={group.id}
            role={onLocate ? "button" : undefined}
            tabIndex={onLocate ? 0 : undefined}
            aria-label={`缩略定位分组${group.title}`}
            onClick={() => onLocate?.(group.nodeIds)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onLocate?.(group.nodeIds);
              }
            }}
          >
            <rect
              {...{ x: box.x, y: box.y, width: box.width, height: box.height }}
              className="workflow-map-group"
              rx={24}
            />
            <title>
              {group.title} · {members.length} 个节点
            </title>
          </g>
        );
      })}
      {graph.edges.map((edge) => {
        const a = nodes.get(edge.source);
        const b = nodes.get(edge.target);
        return a && b ? (
          <line
            key={edge.id}
            x1={a.position.x + 300}
            y1={a.position.y + 92}
            x2={b.position.x}
            y2={b.position.y + 92}
            className="workflow-map-edge"
          />
        ) : null;
      })}
      {graph.nodes.map((node) => (
        <g
          key={node.id}
          role={onLocate ? "button" : undefined}
          tabIndex={onLocate ? 0 : undefined}
          aria-label={`缩略定位节点${node.title}`}
          onClick={() => onLocate?.([node.id])}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onLocate?.([node.id]);
            }
          }}
        >
          <rect
            x={node.position.x}
            y={node.position.y}
            width={300}
            height={184}
            rx={18}
            className={`workflow-map-node ${highlight.includes(node.id) ? "is-highlighted" : ""}`}
          />
          <title>{node.title}</title>
        </g>
      ))}
    </svg>
  );
}
export function WorkflowNavigation({
  graph,
  onLocate,
}: { graph: WorkflowGraph; onLocate(ids: string[]): void }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () =>
      query.trim()
        ? graph.nodes.filter((node) =>
            `${node.title} ${node.note ?? ""}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          )
        : [],
    [graph, query],
  );
  return (
    <details className="workflow-navigation">
      <summary>
        <LocateFixed size={14} />
        <strong>缩略导航</strong>
        <span>
          {graph.nodes.length} 节点 · {graph.groups?.length ?? 0} 组
        </span>
      </summary>
      <WorkflowMap
        graph={graph}
        onLocate={onLocate}
        highlight={matches.map((node) => node.id)}
      />
      <label className="workflow-map-search">
        <Search size={14} />
        <input
          aria-label="查找节点或备注"
          placeholder="查找节点或备注…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="workflow-map-list">
        {query.trim() ? (
          matches.length ? (
            matches.map((node) => (
              <button
                type="button"
                key={node.id}
                onClick={() => onLocate([node.id])}
              >
                {node.title}
                <LocateFixed size={12} />
              </button>
            ))
          ) : (
            <output>没有匹配的节点。</output>
          )
        ) : (
          (graph.groups ?? []).map((group) => (
            <button
              type="button"
              key={group.id}
              onClick={() => onLocate(group.nodeIds)}
            >
              <span>{group.title}</span>
              <small>
                {group.collapsed ? "已折叠 · " : ""}
                {group.nodeIds.length} 节点
              </small>
            </button>
          ))
        )}
      </div>
      <button
        type="button"
        className="workflow-map-overview"
        onClick={() => onLocate(graph.nodes.map((node) => node.id))}
      >
        查看完整流程
      </button>
    </details>
  );
}
