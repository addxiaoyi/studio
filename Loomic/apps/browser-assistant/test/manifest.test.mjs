import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("MV3 assistant never requests cookie or storage permissions", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(!manifest.permissions.includes("cookies"));
  assert.ok(!manifest.permissions.includes("webRequest"));
  const pairingPage = manifest.content_scripts.find((script) => script.js.includes("src/pairing-page.js"));
  assert.ok(pairingPage);
  assert.ok(pairingPage.matches.includes("https://studio.0st.top/desktop-browser-pair.html"));
  assert.ok(pairingPage.matches.includes("http://localhost/desktop-browser-pair.html"));
  assert.ok(pairingPage.matches.every((pattern) => !/^[a-z]+:\/\/[^/]*:\d+\//u.test(pattern)));
  assert.equal(pairingPage.run_at, "document_start");
  assert.match(await readFile(new URL("../src/background.js", import.meta.url), "utf8"), /website_capture\.page/);
  assert.match(await readFile(new URL("../src/background.js", import.meta.url), "utf8"), /from "\.\/action-safety\.js"/);
});
