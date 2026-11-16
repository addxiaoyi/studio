import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("release_topology", Path(__file__).with_name("release-topology.py"))
topology = importlib.util.module_from_spec(spec)
spec.loader.exec_module(topology)


class TopologyTests(unittest.TestCase):
    def gallery_routes(self, config):
        spec = importlib.util.spec_from_file_location("recovery", Path(__file__).with_name("route-public-media-recovery.py"))
        recovery = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(recovery)
        for kind in ("img", "thumbs"):
            config += (f"location ^~ /fashion-gallery/{kind}/ {{\n"
                       f"    proxy_pass http://127.0.0.1:3003/api/public-media/fashion-gallery/{kind}/;\n}}\n")
        return recovery.prepare(config, 3003, 3014)

    def fixture(self, folder, shared=True):
        root = Path(folder).resolve()
        source = root / ".releases/stability-20261110-1"
        cwd = source / "apps/server"
        cwd.mkdir(parents=True)
        entry = source / "packages/shared/dist/index.js"
        if shared:
            entry.parent.mkdir(parents=True)
            entry.write_text("export const version = 'active';")
            (entry.parent.parent / "package.json").write_text('{"name":"@helstera/shared"}')
        probe = patch.object(topology.subprocess, "run", return_value=types.SimpleNamespace(stdout=json.dumps(str(entry))))
        self.node_probe = probe.start()
        self.addCleanup(probe.stop)
        web = root / "apps/web/out"
        web.mkdir(parents=True)
        config = root / "site.conf"
        config.write_text(f"root {web};\nlocation /api/ {{ proxy_pass http://127.0.0.1:3003; }}\n")
        processes = [{"name": "helstera-server-blue", "pm2_env": {"status": "online", "pm_cwd": str(cwd)}},
                     {"name": "helstera-worker-blue", "pm2_env": {"status": "online", "pm_cwd": str(cwd)}},
                     {"name": "helstera-server", "pm2_env": {"status": "stopped"}}]
        return root, source, web, config, processes

    def test_discovers_versioned_source_port_3003_and_blue_process_names(self):
        with tempfile.TemporaryDirectory() as folder:
            root, source, web, config, processes = self.fixture(folder)
            report = topology.inspect(root, config, processes)
            self.assertEqual(report["source"], str(source))
            self.assertEqual(report["web"], str(web))
            self.assertEqual(report["shared"], str(source / "packages/shared/dist"))
            self.assertEqual(report["active"]["port"], 3003)
            self.assertEqual(report["active"]["api"], "helstera-server-blue")
            self.assertIsNone(report["stateSha256"])

    def runtime_shared(self, root, package_name="@helstera/shared"):
        package = root / ".server-runtime/packages/shared"
        dist = package / "dist"
        dist.mkdir(parents=True)
        (dist / "index.js").write_text("export const version = 'loaded-runtime';")
        (package / "package.json").write_text(json.dumps({"name": package_name}))
        return dist

    def test_legacy_layout_uses_the_resolved_runtime_instead_of_stale_root_shared(self):
        with tempfile.TemporaryDirectory() as folder:
            root, source, _, config, processes = self.fixture(folder, shared=False)
            shared = self.runtime_shared(root)
            stale = root / "packages/shared/dist"
            stale.mkdir(parents=True)
            (stale / "index.js").write_text("export const version = 'stale-root';")
            self.node_probe.return_value.stdout = json.dumps(str(shared / "index.js"))
            report = topology.inspect(root, config, processes)
            self.assertEqual(report["shared"], str(shared))
            self.assertFalse((source / "packages/shared/dist").exists())
            self.assertEqual(self.node_probe.call_args.kwargs["cwd"], source / "apps/server")
            self.assertIn("import.meta.resolve", self.node_probe.call_args.args[0][-1])

    def test_a_stale_conventional_dist_does_not_bypass_actual_node_resolution(self):
        with tempfile.TemporaryDirectory() as folder:
            root, source, _, config, processes = self.fixture(folder)
            shared = self.runtime_shared(root)
            self.node_probe.return_value.stdout = json.dumps(str(shared / "index.js"))
            report = topology.inspect(root, config, processes)
            self.assertEqual(report["shared"], str(shared))
            self.assertNotEqual(report["shared"], str(source / "packages/shared/dist"))

    def test_shared_resolution_rejects_a_foreign_package_outside_the_deployment_root(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as foreign:
            root, _, _, config, processes = self.fixture(folder)
            shared = self.runtime_shared(Path(foreign).resolve())
            self.node_probe.return_value.stdout = json.dumps(str(shared / "index.js"))
            with self.assertRaisesRegex(RuntimeError, "shared.*outside.*deployment root"):
                topology.inspect(root, config, processes)

    def test_shared_resolution_rejects_a_wrong_package_name_or_missing_entry(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _, _, config, processes = self.fixture(folder)
            shared = self.runtime_shared(root, "unreviewed-shared")
            self.node_probe.return_value.stdout = json.dumps(str(shared / "index.js"))
            with self.assertRaisesRegex(RuntimeError, "@helstera/shared"):
                topology.inspect(root, config, processes)
            (shared.parent / "package.json").write_text('{"name":"@helstera/shared"}')
            (shared / "index.js").unlink()
            with self.assertRaisesRegex(RuntimeError, "shared.*entry"):
                topology.inspect(root, config, processes)

    def test_shared_resolution_failure_never_falls_back_to_an_existing_dist(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _, _, config, processes = self.fixture(folder)
            self.node_probe.side_effect = subprocess.CalledProcessError(1, ["node"])
            with self.assertRaisesRegex(RuntimeError, "shared.*resolv"):
                topology.inspect(root, config, processes)

    @unittest.skipUnless(shutil.which("node"), "Node.js is not installed")
    def test_real_node_resolution_does_not_evaluate_the_shared_entry(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            cwd = root / ".releases/active/apps/server"
            cwd.mkdir(parents=True)
            shared = self.runtime_shared(root)
            (shared / "index.js").write_text("throw new Error('Shared must not execute during inspection');")
            (shared.parent / "package.json").write_text(json.dumps({
                "name": "@helstera/shared", "type": "module", "exports": {".": {"import": "./dist/index.js"}}}))
            modules = cwd / "node_modules/@helstera"
            modules.mkdir(parents=True)
            try:
                (modules / "shared").symlink_to(shared.parent, target_is_directory=True)
            except OSError as error:
                self.skipTest("Directory symlinks are unavailable: " + str(error))
            web = root / "apps/web/out"
            web.mkdir(parents=True)
            config = root / "site.conf"
            config.write_text(f"root {web};\nlocation /api/ {{ proxy_pass http://127.0.0.1:3003; }}\n")
            processes = [{"name": "helstera-" + kind, "pm2_env": {"status": "online", "pm_cwd": str(cwd)}}
                         for kind in ("server", "worker")]
            self.assertEqual(topology.inspect(root, config, processes)["shared"], str(shared))

    def test_disagreed_saved_pointer_blocks_discovery(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _, _, config, processes = self.fixture(folder)
            report = topology.inspect(root, config, processes)
            (root / ".active-release.json").write_text(json.dumps({**report["active"], "port": 3000}))
            with self.assertRaisesRegex(RuntimeError, "disagrees"):
                topology.inspect(root, config, processes)

    def test_multiple_online_apis_require_explicit_topology_review(self):
        with tempfile.TemporaryDirectory() as folder:
            root, source, _, config, processes = self.fixture(folder)
            processes.append({"name": "helstera-server-green", "pm2_env": {"status": "online", "pm_cwd": str(source / "apps/server")}})
            with self.assertRaisesRegex(RuntimeError, "one active server"):
                topology.inspect(root, config, processes)

    def test_existing_pointer_is_verified_and_fingerprinted(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _, _, config, processes = self.fixture(folder)
            report = topology.inspect(root, config, processes)
            (root / ".active-release.json").write_text(json.dumps(report["active"]))
            checked = topology.inspect(root, config, processes)
            self.assertEqual(len(checked["stateSha256"]), 64)

    def test_verified_gallery_sidecar_does_not_change_the_active_api_port(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _, _, config, processes = self.fixture(folder)
            config.write_text(self.gallery_routes(config.read_text()))
            report = topology.inspect(root, config, processes)
            self.assertEqual(report["active"]["port"], 3003)
            self.assertEqual(config.read_text().count("http://127.0.0.1:3014"), 4)

    def test_gallery_sidecar_does_not_hide_unreviewed_routes_or_upstreams(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _, _, config, processes = self.fixture(folder)
            verified = self.gallery_routes(config.read_text())
            invalid = [
                verified.replace(":3014", ":3015"),
                verified.replace("/api/public-media/fashion-gallery/thumbs/ {", "/api/private/thumbs/ {"),
                verified.replace(":3014/api/public-media/fashion-gallery/img/;", ":3014/private/img/;"),
                verified.replace("location ^~ /fashion-gallery/img/", "location /fashion-gallery/img/"),
                verified + "location /private/ { proxy_pass http://127.0.0.1:3014; }\n",
                verified + "location /other-api/ { proxy_pass http://127.0.0.1:3002; }\n",
                verified + "location ^~ /fashion-gallery/img/ { proxy_pass http://127.0.0.1:3003; }\n",
            ]
            for content in invalid:
                with self.subTest(content=content):
                    config.write_text(content)
                    with self.assertRaises(RuntimeError):
                        topology.inspect(root, config, processes)


if __name__ == "__main__":
    unittest.main()
