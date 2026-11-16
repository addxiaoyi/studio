"""Prepare a hash-pinned legacy release with process-authored lifecycle receipts."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from typing import Any


BASELINE_SERVER_SHA256 = "417371bf7df3adcf883d991f6c4a33107ae789b196adc2ed39c06ed23936609c"
BASELINE_WORKER_SHA256 = "ebde71bbbaad070006a9412f4cd00c7cd000693c51ff9078d75af40ab9145de5"
RECEIPT_IMPORT = 'import { createProcessReceipt } from "./runtime/process-receipt.js";\n'


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def replace_once(text: str, marker: str, replacement: str, label: str) -> str:
    if text.count(marker) != 1:
        raise ValueError("Legacy source marker must occur exactly once: " + label)
    return text.replace(marker, replacement, 1)


def patch_entrypoint(text: str, role: str) -> str:
    if "createProcessReceipt" in text or "receipt.ready()" in text or "receipt.drained()" in text:
        raise ValueError("Legacy entrypoint already contains lifecycle receipts")
    if role == "server":
        marker = 'import { ServiceLifecycle } from "./runtime/lifecycle.js";\n'
        text = replace_once(text, marker, marker + RECEIPT_IMPORT, "server lifecycle import")
        marker = "const lifecycle = new ServiceLifecycle();\n"
        text = replace_once(text, marker, marker + 'const receipt = createProcessReceipt("server");\n', "server receipt scope")
        marker = "    await lifecycle.drain();\n    await app.close();\n"
        text = replace_once(text, marker, marker + "    await receipt.drained();\n", "server successful drain")
        marker = '  process.send?.("ready");\n'
        text = replace_once(text, marker, '  await receipt.ready();\n' + marker, "server ready notification")
        return text
    if role != "worker":
        raise ValueError("Unsupported legacy process role: " + role)
    marker = 'import { PeriodicTasks } from "./runtime/periodic-tasks.js";\n'
    text = replace_once(text, marker, marker + RECEIPT_IMPORT, "worker runtime import")
    marker = "async function main() {\n  const env = loadServerEnv();\n"
    text = replace_once(text, marker, marker + '  const receipt = createProcessReceipt("worker");\n', "worker receipt scope")
    marker = "      await localDb.end();\n      console.log(`${tag} Shutdown complete.`);\n"
    if text.count("      await localDb.end();\n") != 1:
        raise ValueError("Legacy source marker must occur exactly once: worker database shutdown")
    text = replace_once(text, marker, "      await localDb.end();\n      await receipt.drained();\n"
                        "      console.log(`${tag} Shutdown complete.`);\n", "worker successful drain")
    marker = "  console.log(`${tag} Started. concurrency=${JSON.stringify(CONCURRENCY_BY_QUEUE)}, longPollTimeout=${pollTimeoutSeconds}s`);\n"
    text = replace_once(text, marker, marker + '  await receipt.ready();\n  process.send?.("ready");\n', "worker ready notification")
    return text


def tree_files(directory: Path) -> dict[str, str]:
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Bridge input must be a regular directory: " + str(directory))
    files = {}
    for current, folders, names in os.walk(directory, followlinks=False):
        parent = Path(current)
        for name in folders + names:
            path = parent / name
            if path.is_symlink():
                raise ValueError("Bridge source trees must not contain symbolic links: " + str(path))
            if path.is_dir():
                continue
            if not path.is_file():
                raise ValueError("Bridge source contains a non-file entry: " + str(path))
            files[path.relative_to(directory).as_posix()] = sha256(path.read_bytes())
    return files


def pinned_entry(path: Path, expected: str, role: str) -> bytes:
    if not re.fullmatch(r"[a-fA-F0-9]{64}", expected):
        raise ValueError("Expected " + role + " SHA-256 must be explicit and valid")
    content = path.read_bytes()
    if sha256(content) != expected.lower():
        raise ValueError("Legacy " + role + " SHA-256 does not match the reviewed source")
    return content


def prepare_bridge(source: Path, shared: Path, dependencies: Path, receipt_helper: Path, output: Path,
                   server_sha256: str, worker_sha256: str, tsconfig_base: Path | None = None) -> dict[str, Any]:
    source, shared, dependencies = (path.resolve(strict=True) for path in (source, shared, dependencies))
    receipt_helper = receipt_helper.resolve(strict=True)
    output = output.absolute()
    if output.exists() or output.is_symlink():
        raise FileExistsError("Bridge output already exists; inspect it before retrying")
    if output.parent.resolve(strict=True) != output.parent:
        raise ValueError("Bridge output parent must be a resolved regular directory")
    for path in (source, shared, dependencies):
        if output.is_relative_to(path) or path.is_relative_to(output):
            raise ValueError("Bridge output must be separate from every source and dependency tree")
    if not dependencies.is_dir():
        raise ValueError("Pinned dependency directory is missing")
    src = source / "src"
    original_files, shared_files = tree_files(src), tree_files(shared)
    if "runtime/process-receipt.ts" in original_files:
        raise ValueError("Legacy source already has a process receipt helper")
    if "index.js" not in shared_files:
        raise ValueError("Actual Shared runtime must contain index.js")
    server = pinned_entry(src / "server.ts", server_sha256, "server")
    worker = pinned_entry(src / "worker.ts", worker_sha256, "worker")
    patched = {"server.ts": patch_entrypoint(server.decode("utf-8"), "server").encode("utf-8"),
               "worker.ts": patch_entrypoint(worker.decode("utf-8"), "worker").encode("utf-8")}
    helper = receipt_helper.read_bytes()
    if helper.decode("utf-8").count("export function createProcessReceipt(") != 1:
        raise ValueError("Receipt helper is not the reviewed createProcessReceipt implementation")
    metadata = {"apps/server/package.json": source / "package.json",
                "apps/server/tsconfig.json": source / "tsconfig.json",
                "packages/shared/package.json": shared.parent / "package.json"}
    contents = {name: path.read_bytes() for name, path in metadata.items()}
    for name, expected_name in (("apps/server/package.json", "@helstera/server"),
                                ("packages/shared/package.json", "@helstera/shared")):
        if json.loads(contents[name]).get("name") != expected_name:
            raise ValueError("Bridge input package is not named " + expected_name)
    config = json.loads(contents["apps/server/tsconfig.json"])
    base = tsconfig_base.resolve(strict=True) if tsconfig_base is not None else source.parent.parent / "tsconfig.base.json"
    if base.is_file():
        metadata["tsconfig.base.json"] = base
        contents["tsconfig.base.json"] = base.read_bytes()
    elif config.get("extends"):
        raise ValueError("Legacy tsconfig base is missing; supply the pinned --tsconfig-base")
    if config.get("extends") not in (None, "../../tsconfig.base.json"):
        raise ValueError("Legacy tsconfig inheritance is not a recognized bridge layout")
    pinned_dependencies = {}
    for path in dependencies.iterdir():
        if path.name == "@helstera":
            if not path.is_dir():
                raise ValueError("Pinned @helstera dependency scope is not a directory")
            for package in path.iterdir():
                if package.name != "shared":
                    pinned_dependencies["@helstera/" + package.name] = package.resolve(strict=True)
            continue
        pinned_dependencies[path.name] = path.resolve(strict=True)
    shared_dependencies = shared.parent / "node_modules"
    if shared_dependencies.exists() and not shared_dependencies.is_dir():
        raise ValueError("Pinned Shared dependencies are not a directory")
    output.mkdir()
    bridge_src = output / "apps/server/src"
    bridge_shared = output / "packages/shared/dist"
    bridge_src.parent.mkdir(parents=True)
    bridge_shared.parent.mkdir(parents=True)
    shutil.copytree(src, bridge_src)
    shutil.copytree(shared, bridge_shared)
    for name, content in patched.items():
        (bridge_src / name).write_bytes(content)
    (bridge_src / "runtime").mkdir(exist_ok=True)
    (bridge_src / "runtime/process-receipt.ts").write_bytes(helper)
    for name, content in contents.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    links = {}

    def link(relative: str, target: Path) -> None:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.symlink_to(target, target_is_directory=target.is_dir())
        links[relative] = {"target": str(target)}

    modules = output / "apps/server/node_modules"
    modules.mkdir()
    for name, target in sorted(pinned_dependencies.items()):
        link("apps/server/node_modules/" + name, target)
    link("apps/server/node_modules/@helstera/shared", bridge_shared.parent)
    link("node_modules", dependencies)
    link("packages/shared/node_modules", shared_dependencies.resolve(strict=True) if shared_dependencies.exists() else dependencies)
    if (tree_files(src) != original_files or tree_files(shared) != shared_files or
            any(path.read_bytes() != contents[name] for name, path in metadata.items()) or
            receipt_helper.read_bytes() != helper):
        raise RuntimeError("Legacy source changed during bridge preparation; output is not approved")
    files = {}
    for tree in (bridge_src, bridge_shared):
        for name, digest in tree_files(tree).items():
            relative = (tree / name).relative_to(output).as_posix()
            files[relative] = {"sha256": digest}
    for name, content in contents.items():
        files[name] = {"sha256": sha256(content)}
    manifest = {"schemaVersion": 1, "kind": "legacy-lifecycle-bridge", "phase": "prepared",
                "processesStarted": False, "databaseChanged": False, "routesChanged": False, "receiptSupportOnly": True,
                "source": {"server": str(source), "shared": str(shared), "dependencies": str(dependencies),
                           "receiptHelper": str(receipt_helper), "serverSha256": sha256(server),
                           "workerSha256": sha256(worker), "receiptHelperSha256": sha256(helper)},
                "patches": {role: {"beforeSha256": sha256(content), "afterSha256": sha256(patched[role + ".ts"])}
                            for role, content in (("server", server), ("worker", worker))},
                "files": dict(sorted(files.items())), "links": dict(sorted(links.items()))}
    (output / "BRIDGE-MANIFEST.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "shared", "dependencies", "receipt-helper", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--server-sha256", required=True)
    parser.add_argument("--worker-sha256", required=True)
    parser.add_argument("--tsconfig-base", type=Path)
    args = parser.parse_args()
    if args.server_sha256.lower() != BASELINE_SERVER_SHA256 or args.worker_sha256.lower() != BASELINE_WORKER_SHA256:
        parser.error("Entrypoint hashes must match the verified legacy production baseline")
    return args


def main() -> None:
    args = parse_args()
    manifest = prepare_bridge(args.source, args.shared, args.dependencies, args.receipt_helper, args.output,
                              args.server_sha256, args.worker_sha256, args.tsconfig_base)
    print(json.dumps(manifest, sort_keys=True))


if __name__ == "__main__":
    main()
