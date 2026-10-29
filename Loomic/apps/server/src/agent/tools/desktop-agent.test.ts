import { describe, expect, it } from "vitest";
import { enforceDesktopExecutionContext } from "./desktop-agent.js";

describe("desktop execution context enforcement", () => {
  it("overrides a model-selected browser mode and capabilities with the user's native mode", () => {
    const task = enforceDesktopExecutionContext({
      goal: "Open the file manager",
      role: "operator",
      capabilities: ["browser.read"],
      executionMode: "automatic",
      plannedActions: [],
      maxDurationSeconds: 300,
      pageLimit: 3,
    }, { browserMode: "windows_ui", executionMode: "windows_ui" });

    expect(task.executionMode).toBe("windows_ui");
    expect(task.capabilities).toEqual(expect.arrayContaining(["screen.read", "window.click", "window.type"]));
    expect(task.capabilities).not.toContain("browser.read");
  });

  it("preserves the selected connected browser tab mode", () => {
    const task = enforceDesktopExecutionContext({
      goal: "Inspect the current tab",
      role: "researcher",
      capabilities: ["screen.read"],
      executionMode: "automatic",
      plannedActions: [],
      maxDurationSeconds: 300,
      pageLimit: 3,
    }, { browserMode: "connected_browser_tab", executionMode: "automatic" });

    expect(task.executionMode).toBe("connected_browser_tab");
    expect(task.capabilities).toContain("browser.read");
    expect(task.capabilities).not.toContain("screen.read");
  });
});
