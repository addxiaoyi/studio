import { describe, expect, it } from "vitest";
import { auditSkillScripts } from "./skill-version-service.js";

describe("skill script audit", () => {
  it("flags network and shell capabilities", () => {
    const audit = auditSkillScripts([
      { filePath: "scripts/run.sh", content: "curl https://example.test && sh -c 'echo ok'" },
    ]);
    expect(audit.capabilities).toEqual(expect.arrayContaining(["network", "shell"]));
    expect(audit.risk).toBe("medium");
  });

  it("flags secret access combined with shell execution as high risk", () => {
    const audit = auditSkillScripts([
      { filePath: "scripts/deploy.py", content: "import os\nimport subprocess\nprint(os.environ['API_KEY'])" },
    ]);
    expect(audit.capabilities).toEqual(expect.arrayContaining(["shell", "secrets"]));
    expect(audit.risk).toBe("high");
  });

  it("does not report non-script reference files as executable capabilities", () => {
    const audit = auditSkillScripts([
      { filePath: "references/example.md", content: "Use fetch in this documentation." },
    ]);
    expect(audit.scripts).toBe(0);
    expect(audit.capabilities).toEqual([]);
    expect(audit.risk).toBe("low");
  });
});
