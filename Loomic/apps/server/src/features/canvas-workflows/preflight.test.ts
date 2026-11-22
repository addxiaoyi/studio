import type { WorkflowGraph } from "@helstera/shared";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { inspectWorkflow } from "./preflight.js";
import { WorkflowResourceError } from "./resource-error.js";

const mocks = vi.hoisted(() => ({
  material: vi.fn(),
  pin: vi.fn(),
  model: vi.fn(),
  cost: vi.fn(),
}));
vi.mock("./materials.js", () => ({ readWorkflowMaterial: mocks.material }));
vi.mock("./pins.js", () => ({ readPinnedOutput: mocks.pin }));
vi.mock("../../http/model-availability.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../http/model-availability.js")
  >()),
  resolveConfiguredModel: mocks.model,
}));
vi.mock("../credits/tier-guard.js", () => ({
  createLocalCostGuard: () => ({ calculateCreditCost: mocks.cost }),
}));
const scope = {
  canvasId: "canvas",
  workflowId: "flow",
  workspaceId: "workspace",
  userId: "user",
};
const position = { x: 0, y: 0 };
const graph = (): WorkflowGraph => ({
  title: "检查",
  nodes: [
    {
      id: "asset",
      title: "失效素材",
      position,
      config: {
        kind: "asset",
        mediaType: "image",
        elementId: "element",
        assetId: "11111111-1111-4111-8111-111111111111",
      },
    },
    {
      id: "image",
      title: "图片生成",
      position,
      config: {
        kind: "generate",
        mediaType: "image",
        model: "model",
        prompt: "woodland",
        aspectRatio: "16:9",
        duration: 5,
        resolution: "720p",
      },
    },
    { id: "output", title: "交付", position, config: { kind: "deliver" } },
  ],
  edges: [
    { id: "a", source: "asset", target: "output" },
    { id: "b", source: "image", target: "output" },
  ],
});
const store = { query: vi.fn() } as unknown as Pick<Pool, "query">;
const healthy = {
  model_id: "model",
  billing_unit: "per_generation",
  price_credits: 1,
  input_token_price_cny: null,
  output_token_price_cny: null,
};

describe("workflow preflight", () => {
  it("checks an author once for all unpinned writer nodes and exposes each blocker", async () => {
    const draft: WorkflowGraph = { title: "编剧", nodes: [
      { id: "source", title: "输入", position, config: { kind: "text", role: "story", text: "hello" } },
      { id: "writer", title: "编剧", position, config: { kind: "write", mode: "rewrite", instruction: "write", shotCount: 1 } },
      { id: "script", title: "剧本", position, config: { kind: "write", mode: "script", instruction: "script", shotCount: 1 } },
      { id: "output", title: "交付", position, config: { kind: "deliver" } },
    ], edges: [{ id: "a", source: "source", target: "writer" }, { id: "b", source: "writer", target: "script" }, { id: "c", source: "script", target: "output" }] };
    const check = vi.fn().mockResolvedValue({ ready: false, message: "认证失败" });
    const report = await inspectWorkflow(store, draft, scope, 1, undefined, check);
    expect(check).toHaveBeenCalledOnce();
    expect(report.issues.map(issue => [issue.nodeId, issue.code])).toEqual([["writer", "author"], ["script", "author"]]);
  });
  it("collects resource, model and structural failures together without creating work", async () => {
    mocks.material.mockRejectedValue(new WorkflowResourceError("素材已到期"));
    mocks.model.mockResolvedValue(null);
    const draft = graph();
    draft.nodes.push({
      id: "empty",
      title: "空资料",
      position,
      config: { kind: "text", role: "story", text: "" },
    });
    draft.edges.push({ id: "c", source: "empty", target: "output" });
    const report = await inspectWorkflow(store, draft, scope, 1);
    expect(report.ready).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual([
      "structure",
      "material",
      "model",
    ]);
    expect(report.issues.map((issue) => issue.nodeId)).toEqual([
      "empty",
      "asset",
      "image",
    ]);
    expect(mocks.model).toHaveBeenCalledWith(
      store,
      "image",
      "model",
      expect.objectContaining({ readOnly: true, strictRequested: true }),
    );
    expect(store.query).not.toHaveBeenCalled();
  });
  it("checks only the requested execution scope", async () => {
    mocks.material.mockResolvedValue({ id: "asset" });
    mocks.model.mockResolvedValue(null);
    const report = await inspectWorkflow(store, graph(), scope, 1, "asset");
    expect(report.ready).toBe(true);
    expect(report.quotes).toEqual([]);
  });
  it("does not label a database outage as an expired resource", async () => {
    mocks.material.mockRejectedValue(new Error("database unavailable"));
    await expect(inspectWorkflow(store, graph(), scope, 1)).rejects.toThrow(
      "database unavailable",
    );
  });
  it("reports unsupported billing and invalid prices; retains legitimate zero-cost generation", async () => {
    mocks.material.mockResolvedValue({ id: "asset" });
    mocks.model.mockResolvedValue({
      ...healthy,
      billing_unit: "per_million_tokens",
    });
    expect((await inspectWorkflow(store, graph(), scope, 2)).issues).toEqual([
      expect.objectContaining({ nodeId: "image", code: "price" }),
    ]);
    mocks.model.mockResolvedValue({ ...healthy, price_credits: Number.NaN });
    expect((await inspectWorkflow(store, graph(), scope, 2)).ready).toBe(false);
    mocks.model.mockResolvedValue({ ...healthy, price_credits: 0 });
    expect((await inspectWorkflow(store, graph(), scope, 2)).quotes).toEqual([
      { nodeId: "image", title: "图片生成", model: "model", credits: 0 },
    ]);
  });
  it("prunes upstream generation when a validated result is pinned", async () => {
    const draft = graph();
    draft.nodes[0] = {
      id: "asset",
      title: "固定文字",
      position,
      config: {
        kind: "transform",
        operation: "trim",
        search: "",
        replacement: "",
      },
      pin: { goalId: "11111111-1111-4111-8111-111111111111", nodeId: "asset" },
    };
    draft.edges = [
      { id: "upstream", source: "image", target: "asset" },
      { id: "a", source: "asset", target: "output" },
    ];
    mocks.pin.mockResolvedValue({ text: "saved" });
    const before = mocks.model.mock.calls.length;
    expect((await inspectWorkflow(store, draft, scope, 1)).ready).toBe(true);
    expect(mocks.model.mock.calls).toHaveLength(before);
  });
});
