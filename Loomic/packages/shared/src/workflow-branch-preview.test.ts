import { describe, expect, it } from "vitest";
import {
  type WorkflowBranchConfig,
  evaluateWorkflowBranches,
} from "./workflow-branch-preview.js";

const scoreRule = {
  field: "json.score",
  operator: "greater_than",
  value: "70",
} as const;
const switchConfig: WorkflowBranchConfig = {
  kind: "switch",
  mode: "first",
  cases: [
    { id: "high", title: "高分", match: "all", conditions: [scoreRule] },
    {
      id: "present",
      title: "有评分",
      match: "all",
      conditions: [{ ...scoreRule, operator: "not_empty" }],
    },
  ],
};

describe("local workflow branch evaluation", () => {
  it("shows the actual nested value and each condition for IF all/any", () => {
    const config: WorkflowBranchConfig = {
      kind: "condition",
      match: "all",
      conditions: [
        scoreRule,
        { field: "text", operator: "contains", value: "ready" },
      ],
    };
    const preview = evaluateWorkflowBranches(
      { json: { score: 80 }, text: "waiting" },
      config,
    );
    expect(preview.branches).toEqual(["false"]);
    expect(
      preview.routes[0]?.conditions.map((condition) => [
        condition.actual,
        condition.matched,
      ]),
    ).toEqual([
      [80, true],
      ["waiting", false],
    ]);
    expect(
      evaluateWorkflowBranches(
        { json: { score: 80 }, text: "waiting" },
        { ...config, match: "any" },
      ).branches,
    ).toEqual(["true"]);
  });
  it("stops at the first matching Switch route and supports all matches", () => {
    const source = { json: { score: 80 } };
    const first = evaluateWorkflowBranches(source, switchConfig);
    expect(first.branches).toEqual(["high"]);
    expect(first.routes.map((route) => route.id)).toEqual(["high"]);
    expect(
      evaluateWorkflowBranches(source, { ...switchConfig, mode: "all" })
        .branches,
    ).toEqual(["high", "present"]);
  });
  it("uses the default route when fields are missing or null", () => {
    for (const source of [{}, { json: { score: null } }]) {
      const preview = evaluateWorkflowBranches(source, switchConfig);
      expect(preview.branches).toEqual(["default"]);
      expect(preview.routes.every((route) => !route.matched)).toBe(true);
    }
  });
  it("rejects malformed rules, unsafe paths and ambiguous branch identifiers", () => {
    expect(() =>
      evaluateWorkflowBranches(
        {},
        { kind: "condition", match: "all", conditions: [] },
      ),
    ).toThrow("条件配置无效");
    expect(() =>
      evaluateWorkflowBranches(
        {},
        {
          kind: "condition",
          match: "all",
          conditions: [{ ...scoreRule, field: "__proto__.score" }],
        },
      ),
    ).toThrow("字段路径无效");
    expect(() =>
      evaluateWorkflowBranches(
        { json: { score: 80 } },
        {
          kind: "condition",
          match: "all",
          conditions: [{ ...scoreRule, value: "wrong" }],
        },
      ),
    ).toThrow("数值条件");
    expect(() =>
      evaluateWorkflowBranches(
        {},
        {
          ...switchConfig,
          cases: [...switchConfig.cases, ...switchConfig.cases],
        },
      ),
    ).toThrow("出口标识重复");
  });
});
