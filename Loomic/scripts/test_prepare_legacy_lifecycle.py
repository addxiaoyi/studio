from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


SERVER_SHA256 = "417371bf7df3adcf883d991f6c4a33107ae789b196adc2ed39c06ed23936609c"
WORKER_SHA256 = "ebde71bbbaad070006a9412f4cd00c7cd000693c51ff9078d75af40ab9145de5"
SERVER_FIXTURE = '''import { ServiceLifecycle } from "./runtime/lifecycle.js";
const env = loadServerEnv();
const lifecycle = new ServiceLifecycle();
const app = buildFixtureApp(env, lifecycle);
const host = "127.0.0.1";
let stopping: Promise<void> | undefined;
const stop = () => {
  stopping ??= (async () => {
    await lifecycle.drain();
    await app.close();
  })().catch(error => { app.log.error(error, "Graceful shutdown failed"); process.exitCode = 1; });
};
process.once("SIGTERM", stop); process.once("SIGINT", stop);
try {
  await app.listen({ host, port: env.port });
  const readiness = await app.inject("/api/health/ready");
  if (readiness.statusCode !== 200) throw new Error("Server dependencies are not ready");
  process.send?.("ready");
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
'''
WORKER_FIXTURE = '''import { PeriodicTasks } from "./runtime/periodic-tasks.js";
async function main() {
  const env = loadServerEnv();
  const { localDb, pgmq, maintenance, runner, stopOneTake } = createFixtureWorker(env);
  const tag = "[fixture]";
  const CONCURRENCY_BY_QUEUE = { fixture: 1 };
  const pollTimeoutSeconds = 1;
  let stopping: Promise<void> | undefined;
  const shutdown = () => {
    stopping ??= (async () => {
      console.log(`${tag} Shutting down, waiting for ${runner.activeCount} in-flight jobs...`);
      const drained = runner.stop();
      await pgmq.shutdown();
      await Promise.all([drained, maintenance.stop(), stopOneTake()]);
      await localDb.end();
      console.log(`${tag} Shutdown complete.`);
    })().catch(error => { console.error(`${tag} Shutdown failed:`, error); process.exitCode = 1; });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log(`${tag} Started. concurrency=${JSON.stringify(CONCURRENCY_BY_QUEUE)}, longPollTimeout=${pollTimeoutSeconds}s`);
}
'''


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bridge_fixture(folder: str) -> types.SimpleNamespace:
    root = Path(folder).resolve()
    source = root / "legacy/apps/server"
    source.joinpath("src/runtime").mkdir(parents=True)
    for role, text in (("server", SERVER_FIXTURE), ("worker", WORKER_FIXTURE)):
        (source / "src" / (role + ".ts")).write_bytes(text.encode())
    (source / "src/app.ts").write_bytes(b"export const legacyApp = true;\n")
    (source / "src/runtime/lifecycle.ts").write_bytes(b"export class ServiceLifecycle {}\n")
    (source / "src/runtime/periodic-tasks.ts").write_bytes(b"export class PeriodicTasks {}\n")
    (source / "package.json").write_text('{"name":"@helstera/server","type":"module","version":"legacy"}')
    (source / "tsconfig.json").write_text('{"extends":"../../tsconfig.base.json"}')
    (source.parent.parent / "tsconfig.base.json").write_text('{"compilerOptions":{"strict":true}}')
    shared = root / "runtime/packages/shared/dist"
    shared.mkdir(parents=True)
    (shared / "index.js").write_bytes(b"export const oldShared = 'actual';\n")
    (shared.parent / "package.json").write_text('{"name":"@helstera/shared","type":"module","exports":{".":{"import":"./dist/index.js"}}}')
    dependencies = root / "runtime/apps/server/node_modules"
    (dependencies / "pg").mkdir(parents=True)
    (dependencies / "pg/package.json").write_text('{"name":"pg"}')
    (dependencies / "@helstera").mkdir()
    try:
        (dependencies / "@helstera/shared").symlink_to(shared.parent, target_is_directory=True)
    except OSError as error:
        raise unittest.SkipTest("Directory symlinks are unavailable: " + str(error))
    receipt = root / "verified/process-receipt.ts"
    receipt.parent.mkdir()
    receipt.write_bytes((Path(__file__).resolve().parents[1] / "apps/server/src/runtime/process-receipt.ts").read_bytes())
    return types.SimpleNamespace(root=root, source=source, shared=shared, dependencies=dependencies,
                                 receipt=receipt, output=root / "bridge",
                                 server_hash=sha256(source / "src/server.ts"), worker_hash=sha256(source / "src/worker.ts"))


class LegacyLifecycleTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name("prepare-legacy-lifecycle.py")
        if not path.is_file():
            self.fail("Missing legacy lifecycle bridge builder: " + str(path))
        spec = importlib.util.spec_from_file_location("prepare_legacy_lifecycle", path)
        if spec is None or spec.loader is None:
            raise RuntimeError("Legacy lifecycle bridge builder could not be loaded")
        self.bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.bridge)

    def prepare(self, fixture, server_hash=None, worker_hash=None):
        return self.bridge.prepare_bridge(fixture.source, fixture.shared, fixture.dependencies,
                                          fixture.receipt, fixture.output, server_hash or fixture.server_hash,
                                          worker_hash or fixture.worker_hash)

    def test_bridge_copies_only_the_pinned_legacy_code_and_preserves_originals(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = bridge_fixture(folder)
            before = {path: path.read_bytes() for base in (fixture.source, fixture.shared, fixture.dependencies)
                      for path in base.rglob("*") if path.is_file() and not path.is_symlink()}
            report = self.prepare(fixture)
            self.assertEqual(report["phase"], "prepared")
            for flag in ("processesStarted", "databaseChanged", "routesChanged"):
                self.assertIs(report[flag], False)
            self.assertIs(report["receiptSupportOnly"], True)
            for field in ("pid", "instanceId", "state"):
                self.assertNotIn(field, report)
            for path, content in before.items():
                self.assertEqual(path.read_bytes(), content, str(path))
            for original in (fixture.source / "src").rglob("*"):
                if not original.is_file():
                    continue
                relative = original.relative_to(fixture.source)
                target = fixture.output / "apps/server" / relative
                if relative.as_posix() in ("src/server.ts", "src/worker.ts"):
                    self.assertEqual(target.read_text(encoding="utf-8"),
                                     self.bridge.patch_entrypoint(original.read_text(encoding="utf-8"), original.stem))
                else:
                    self.assertEqual(target.read_bytes(), original.read_bytes())
            self.assertEqual((fixture.output / "apps/server/src/runtime/process-receipt.ts").read_bytes(),
                             fixture.receipt.read_bytes())
            self.assertEqual((fixture.output / "packages/shared/dist/index.js").read_bytes(),
                             (fixture.shared / "index.js").read_bytes())
            self.assertFalse((fixture.output / "packages/shared/dist").is_symlink())
            self.assertEqual((fixture.output / "packages/shared/package.json").read_bytes(),
                             (fixture.shared.parent / "package.json").read_bytes())
            self.assertEqual((fixture.output / "apps/server/package.json").read_bytes(),
                             (fixture.source / "package.json").read_bytes())
            self.assertEqual((fixture.output / "apps/server/tsconfig.json").read_bytes(),
                             (fixture.source / "tsconfig.json").read_bytes())
            self.assertEqual((fixture.output / "tsconfig.base.json").read_bytes(),
                             (fixture.source.parent.parent / "tsconfig.base.json").read_bytes())
            self.assertEqual(report["source"]["serverSha256"], fixture.server_hash)
            self.assertEqual(report["source"]["workerSha256"], fixture.worker_hash)
            self.assertEqual(report["source"]["receiptHelperSha256"], sha256(fixture.receipt))
            for role in ("server", "worker"):
                self.assertNotEqual(report["patches"][role]["beforeSha256"], report["patches"][role]["afterSha256"])

    def test_bridge_dependencies_use_its_own_shared_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = bridge_fixture(folder)
            self.prepare(fixture)
            modules = fixture.output / "apps/server/node_modules"
            self.assertFalse(modules.is_symlink())
            self.assertTrue((modules / "pg").is_symlink())
            self.assertEqual((modules / "pg").resolve(), (fixture.dependencies / "pg").resolve())
            self.assertTrue((modules / "@helstera/shared").is_symlink())
            self.assertEqual((modules / "@helstera/shared").resolve(), fixture.output / "packages/shared")
            self.assertEqual((fixture.dependencies / "@helstera/shared").resolve(), fixture.shared.parent)
            if not shutil.which("node"):
                return
            probe = "import {fileURLToPath} from 'node:url';console.log(fileURLToPath(import.meta.resolve('@helstera/shared')));"
            checked = subprocess.run(["node", "--input-type=module", "-e", probe], cwd=modules.parent,
                                     capture_output=True, text=True)
            self.assertEqual(checked.returncode, 0, checked.stderr)
            self.assertEqual(Path(checked.stdout.strip()).resolve(), fixture.output / "packages/shared/dist/index.js")

    def test_wrong_hash_and_missing_sources_fail_before_creating_output(self):
        for problem in ("server hash", "worker hash", "missing server", "missing worker", "missing shared"):
            with self.subTest(problem=problem), tempfile.TemporaryDirectory() as folder:
                fixture = bridge_fixture(folder)
                server_hash, worker_hash = fixture.server_hash, fixture.worker_hash
                if problem == "server hash":
                    server_hash = "0" * 64
                elif problem == "worker hash":
                    worker_hash = "0" * 64
                elif problem == "missing shared":
                    (fixture.shared / "index.js").unlink()
                else:
                    (fixture.source / "src" / (problem.removeprefix("missing ") + ".ts")).unlink()
                with self.assertRaises((ValueError, RuntimeError, FileNotFoundError)):
                    self.prepare(fixture, server_hash, worker_hash)
                self.assertFalse(fixture.output.exists())

    def test_unknown_patch_markers_fail_before_creating_output_even_with_matching_hash(self):
        for role, marker in (("server", '  process.send?.("ready");'),
                             ("worker", "      await localDb.end();")):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as folder:
                fixture = bridge_fixture(folder)
                entry = fixture.source / "src" / (role + ".ts")
                changed = entry.read_text(encoding="utf-8").replace(marker, "// inspected marker was removed")
                entry.write_bytes(changed.encode())
                hashes = {"server": fixture.server_hash, "worker": fixture.worker_hash}
                hashes[role] = sha256(entry)
                with self.assertRaises((ValueError, RuntimeError)):
                    self.prepare(fixture, hashes["server"], hashes["worker"])
                self.assertFalse(fixture.output.exists())

    def test_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = bridge_fixture(folder)
            fixture.output.mkdir()
            note = fixture.output / "original.txt"
            note.write_bytes(b"existing bridge must be preserved")
            with self.assertRaises((FileExistsError, ValueError, RuntimeError)):
                self.prepare(fixture)
            self.assertEqual(note.read_bytes(), b"existing bridge must be preserved")
            self.assertEqual(list(fixture.output.iterdir()), [note])

    def test_patch_anchors_are_unique_and_unknown_roles_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = bridge_fixture(folder)
            for role, marker in (("server", '  process.send?.("ready");'),
                                 ("worker", "      await localDb.end();")):
                text = (fixture.source / "src" / (role + ".ts")).read_text(encoding="utf-8")
                with self.subTest(role=role), self.assertRaises((ValueError, RuntimeError)):
                    self.bridge.patch_entrypoint(text + "\n" + marker + "\n", role)
            with self.assertRaises((ValueError, RuntimeError)):
                self.bridge.patch_entrypoint("export {};", "scheduler")

    def test_cli_refuses_nonbaseline_hash_overrides_before_preparation(self):
        arguments = ["prepare-legacy-lifecycle.py", "--source", "old-server", "--shared", "old-shared",
                     "--dependencies", "old-dependencies", "--receipt-helper", "process-receipt.ts",
                     "--output", "bridge", "--server-sha256", "0" * 64, "--worker-sha256", WORKER_SHA256]
        with patch.object(sys, "argv", arguments), self.assertRaises(SystemExit) as failure:
            self.bridge.parse_args()
        self.assertEqual(failure.exception.code, 2)

    def test_ready_markers_follow_real_startup_and_precede_pm2_notifications(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = bridge_fixture(folder)
            server = self.bridge.patch_entrypoint((fixture.source / "src/server.ts").read_text(encoding="utf-8"), "server")
            worker = self.bridge.patch_entrypoint((fixture.source / "src/worker.ts").read_text(encoding="utf-8"), "worker")
            self.assertLess(server.index("await app.listen("), server.index("await receipt.ready();"))
            self.assertLess(server.index('if (readiness.statusCode !== 200)'), server.index("await receipt.ready();"))
            self.assertLess(server.index("await receipt.ready();"), server.index('process.send?.("ready");'))
            self.assertLess(worker.index("  console.log(`${tag} Started."), worker.index("await receipt.ready();"))
            self.assertLess(worker.index("await receipt.ready();"), worker.index('process.send?.("ready");'))
            for patched in (server, worker):
                self.assertEqual(patched.count("await receipt.ready();"), 1)
                self.assertEqual(patched.count("await receipt.drained();"), 1)

    @unittest.skipUnless(shutil.which("node"), "Node.js is not installed")
    def test_patched_shutdown_waits_for_held_work_and_never_receipts_failed_close(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = bridge_fixture(folder)
            for role in ("server", "worker"):
                patched = self.bridge.patch_entrypoint((fixture.source / "src" / (role + ".ts")).read_text(encoding="utf-8"), role)
                start = patched.index("let stopping: Promise<void> | undefined;")
                end = patched.index("process.once(", start)
                shutdown = patched[start:end].replace("let stopping: Promise<void> | undefined;", "let stopping;")
                for failure in (False, True):
                    script = """
import assert from 'node:assert/strict';
let release; const held = new Promise(resolve => { release = resolve; });
let drained = false; let closeCalled = false;
const receipt = { drained: async () => { drained = true; } };
const lifecycle = { drain: async () => { await held; } };
const runner = { activeCount: 1, stop: () => held };
const pgmq = { shutdown: async () => {} };
const maintenance = { stop: async () => {} };
const stopOneTake = async () => {};
const tag = '[fixture]';
const finish = async () => { closeCalled = true; if (FAIL_CLOSE) throw new Error('held close failed'); };
const app = {close: finish, log: {error: () => {}}};
const localDb = {end: finish};
""".replace("FAIL_CLOSE", "true" if failure else "false")
                    script += shutdown + "\n" + ("stop();" if role == "server" else "shutdown();")
                    script += """
await new Promise(resolve => setImmediate(resolve));
assert.equal(drained, false); assert.equal(closeCalled, false);
release(); await stopping;
assert.equal(closeCalled, true);
assert.equal(drained, EXPECT_DRAINED);
assert.equal(process.exitCode ?? 0, EXPECT_EXIT);
process.exitCode = 0;
""".replace("EXPECT_DRAINED", "false" if failure else "true").replace("EXPECT_EXIT", "1" if failure else "0")
                    with self.subTest(role=role, failure=failure):
                        checked = subprocess.run(["node", "--input-type=module", "-e", script],
                                                 capture_output=True, text=True)
                        self.assertEqual(checked.returncode, 0, checked.stderr)


if __name__ == "__main__":
    unittest.main()
