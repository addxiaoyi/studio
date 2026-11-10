import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { installCreativeDeps } from "./install-creative-deps.mjs";

const fixture = Buffer.from('{"packages":{"react":["react@19.0.0","https://registry.npmmirror.com/react/-/react-19.0.0.tgz",{},"sha512-pinned-integrity"]}}\r\n');
function directory(t) {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, "helstera-creative-deps-"));
  writeFileSync(join(root, "bun.lock"), fixture);
  t.after(() => { assert.equal(dirname(root), parent); rmSync(root, { recursive: true }); });
  return root;
}

test("switches tarball host while retaining pinned versions, integrity and original checkout", t => {
  const root = directory(t);
  installCreativeDeps(root, (command, args, options) => {
    assert.equal(command, "bun");
    assert.ok(args.includes("--frozen-lockfile"));
    assert.ok(args.includes("--ignore-scripts"));
    assert.ok(args.includes("--registry=https://registry.npmjs.org"));
    assert.equal(options.timeout, 300000);
    const lock = JSON.parse(readFileSync(join(root, "bun.lock"), "utf8"));
    assert.deepEqual(lock.packages.react, ["react@19.0.0", "https://registry.npmjs.org/react/-/react-19.0.0.tgz", {}, "sha512-pinned-integrity"]);
  });
  assert.deepEqual(readFileSync(join(root, "bun.lock")), fixture);
});

test("retries a timed out install and restores bytes after terminal failure", t => {
  const root = directory(t);
  let attempts = 0;
  assert.throws(() => installCreativeDeps(root, () => { attempts++; throw Object.assign(new Error("network timeout"), { code: "ETIMEDOUT" }); }), /after 2 attempts/);
  assert.equal(attempts, 2);
  assert.deepEqual(readFileSync(join(root, "bun.lock")), fixture);
});

test("fails immediately when Bun is missing and leaves the pinned source unchanged", t => {
  const root = directory(t);
  let attempts = 0;
  assert.throws(() => installCreativeDeps(root, () => { attempts++; throw Object.assign(new Error("missing"), { code: "ENOENT" }); }), /Bun is unavailable/);
  assert.equal(attempts, 1);
  assert.deepEqual(readFileSync(join(root, "bun.lock")), fixture);
});
