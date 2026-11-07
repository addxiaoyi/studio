import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("website capture task idempotency scope", () => {
  it("scopes both task inserts and duplicate lookups to the workspace", () => {
    const source = readFileSync(new URL("./runtime.ts", import.meta.url), "utf8");
    const capture = source.slice(source.indexOf("submitWebsiteCapture = async (input) =>"), source.indexOf("let jobId = task.background_job_id;"));

    expect(capture.match(/on conflict \(workspace_id, created_by, idempotency_key\) do nothing/g)).toHaveLength(2);
    expect(capture.match(/from website_capture_tasks where workspace_id=\$1 and created_by=\$2 and idempotency_key=\$3/g)).toHaveLength(2);
    expect(capture.match(/\[workspaceId, userId, idempotencyKey, startUrl\.toString\(\)/g)).toHaveLength(2);
    expect(capture.match(/and start_url=\$4 and mode=\$5 and page_limit=\$6 and record_video=\$7 and follow_external=\$8/g)).toHaveLength(2);
  });
});
