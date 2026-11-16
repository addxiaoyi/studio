import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  describeRendererExit,
  recordRendererExit,
} from "./renderer-startup-diagnostics.mjs";

test("reports breakpoint exits without treating the status alone as a sandbox diagnosis", () => {
  const message = describeRendererExit(
    { code: 2147483651, signal: null, healthReportExists: false },
    "fixture",
  );
  assert.match(message, /0x80000003.*before writing its report/);
  assert.doesNotMatch(message, /restricted|window-station/);
});

test("distinguishes a restricted launcher observation from an application report", () => {
  const message = describeRendererExit(
    {
      code: 1,
      signal: null,
      healthReportExists: true,
      windows: { restrictedToken: true },
    },
    "fixture",
  );
  assert.match(message, /after writing its report/);
  assert.match(message, /launcher token is restricted/);
  assert.doesNotMatch(message, /no-sandbox/);
});

test("preserves a signal termination in its diagnostic", () => {
  assert.match(
    describeRendererExit(
      { code: null, signal: "SIGTERM", healthReportExists: false },
      "fixture",
    ),
    /signal SIGTERM/,
  );
});

test("records whether the application produced health evidence", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "helstera-launcher-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, "health.json"), '{"ok":false}');
  const diagnostic = await recordRendererExit(1, null, folder);
  assert.equal(diagnostic.healthReportExists, true);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(folder, "startup-diagnostics.json"), "utf8"),
    ),
    diagnostic,
  );
  if (process.platform === "win32") {
    if (diagnostic.windows) {
      assert.equal(typeof diagnostic.windows.restrictedToken, "boolean");
      assert.equal(typeof diagnostic.windows.inJob, "boolean");
    } else {
      assert.equal(typeof diagnostic.windowsProbeError, "string");
      assert.match(
        describeRendererExit(diagnostic, folder),
        /inspection was unavailable/,
      );
    }
  }
});
