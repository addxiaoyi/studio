import {expect,it} from "vitest";
import {productLabel} from "@/lib/product-label";
it("unifies old product template labels without changing ordinary user text",()=>{
  expect(productLabel("融光创作设计 · 机器人花园分镜")).toBe("Helstera · 机器人花园分镜");
  expect(productLabel("Loomic — 我的工作流")).toBe("Helstera — 我的工作流");
  expect(productLabel("融光创作设计")).toBe("Helstera");
  expect(productLabel("我的融光摄影主题")).toBe("我的融光摄影主题");
});
