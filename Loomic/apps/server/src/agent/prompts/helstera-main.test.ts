import { describe, expect, it } from "vitest";

import { HELSTERA_SYSTEM_PROMPT } from "./helstera-main.js";

describe("HELSTERA_SYSTEM_PROMPT task truthfulness", () => {
  it("does not treat accepted background jobs as completed output", () => {
    expect(HELSTERA_SYSTEM_PROMPT).toContain("pending: true");
    expect(HELSTERA_SYSTEM_PROMPT).toContain("只能说明“已提交/后台处理中”");
    expect(HELSTERA_SYSTEM_PROMPT).toContain("禁止说“已生成/已完成”");
  });

  it("does not confuse canvas totals with current-turn image output", () => {
    expect(HELSTERA_SYSTEM_PROMPT).toContain("不代表本轮新增内容，也不等于图片数量");
    expect(HELSTERA_SYSTEM_PROMPT).toContain("不得用画布总元素数回答“本次生成了几张”");
    expect(HELSTERA_SYSTEM_PROMPT).toContain("画布共有 N 个元素");
  });

  it("requires final artifacts before claiming success", () => {
    expect(HELSTERA_SYSTEM_PROMPT).toContain("最终资产、最终 URL 或明确的成功产物");
    expect(HELSTERA_SYSTEM_PROMPT).toContain("本轮成功工具结果能逐项证明");
  });
});
