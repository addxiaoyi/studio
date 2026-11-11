"""Assemble an inspectable candidate from an isolated Web/Shared build."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ONETAKE_SHA = "c461e5be04492cae7a19ee21c31270b25d9746be5222706ec2da0ed11f5ac706"
INPUT_TREES = ("apps/web/src", "packages/shared/src")
INPUT_FILES = (
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
    "apps/web/package.json", "apps/web/next.config.ts", "apps/web/postcss.config.mjs", "apps/web/tsconfig.json",
    "packages/shared/package.json", "packages/shared/tsconfig.json",
)
INCLUDE_TREES = (
    ("apps/server/src", "source"),
    ("apps/web/out", "build"),
    ("packages/shared/dist", "build"),
)
INCLUDE_FILES = (
    "apps/server/package.json", "apps/server/tsconfig.json", "apps/desktop/package.json",
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
)


def files_under(directory: Path, *, exclude_downloads: bool = False) -> dict[str, Path]:
    if not directory.is_dir():
        raise FileNotFoundError(directory)
    found: dict[str, Path] = {}
    for current, dirs, names in os.walk(directory, followlinks=False):
        parent = Path(current)
        dirs[:] = [name for name in dirs if name != "node_modules" and not (parent / name).is_symlink()
                   and not (exclude_downloads and parent == directory and name == "downloads")]
        for name in names:
            path = parent / name
            if path.is_symlink():
                raise ValueError(f"Symbolic link is not allowed in candidate inputs: {path}")
            if path.is_file():
                found[path.relative_to(directory).as_posix()] = path
    return found


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def server_runtime_manifests(source: Path) -> dict[str, Path]:
    runtime = Path("deploy/server-runtime")
    manifests = [source / name for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml")]
    manifests.extend(source / app / "package.json" for app in ("apps/server", "apps/web", "apps/desktop"))
    packages = source / "packages"
    if not packages.is_dir() or packages.is_symlink():
        raise FileNotFoundError(packages)
    package_dirs = sorted(packages.iterdir())
    if any(path.is_symlink() for path in package_dirs):
        raise ValueError("Symbolic links are not allowed in server runtime workspaces.")
    manifests.extend(path / "package.json" for path in package_dirs if path.is_dir())

    runtime_files: dict[str, Path] = {}
    for manifest in manifests:
        if not manifest.is_file() or manifest.is_symlink():
            raise FileNotFoundError(manifest)
        relative = manifest.relative_to(source).as_posix()
        runtime_files[(runtime / relative).as_posix()] = manifest
    return runtime_files


def verify_build_inputs(source: Path, build: Path) -> None:
    for relative in INPUT_TREES + ("apps/web/public",):
        source_files = files_under(source / relative, exclude_downloads=relative == "apps/web/public")
        build_files = files_under(build / relative, exclude_downloads=relative == "apps/web/public")
        if source_files.keys() != build_files.keys():
            raise ValueError(f"Build input file list differs: {relative}")
        for name, path in source_files.items():
            if sha256(path) != sha256(build_files[name]):
                raise ValueError(f"Build input differs: {relative}/{name}")
    for relative in INPUT_FILES:
        if sha256(source / relative) != sha256(build / relative):
            raise ValueError(f"Build input differs: {relative}")


def create_candidate(source: Path, build: Path, destination: Path) -> str:
    if destination.exists():
        raise FileExistsError(destination)
    verify_build_inputs(source, build)
    paths: dict[str, Path] = {}
    for relative, origin in INCLUDE_TREES:
        root = (source if origin == "source" else build) / relative
        for name, path in files_under(root, exclude_downloads=relative == "apps/web/out").items():
            paths[f"{relative}/{name}"] = path
    paths.update(server_runtime_manifests(source))
    # The runtime must load the same contracts as the candidate source tree.
    for name, path in files_under(build / "packages/shared/dist").items():
        paths[f"deploy/server-runtime/packages/shared/dist/{name}"] = path
    for relative in INCLUDE_FILES:
        path = source / relative
        if not path.is_file() or path.is_symlink():
            raise FileNotFoundError(path)
        paths[relative] = path
    paths.update(one_take_sources(source))
    required = ("apps/web/out/index.html", "apps/web/out/fashion-gallery/index.html",
                "apps/web/out/video/index.html", "packages/shared/dist/contracts.js",
                "deploy/server-runtime/pnpm-lock.yaml", "deploy/server-runtime/apps/server/package.json",
                "deploy/server-runtime/packages/shared/package.json", "apps/server/src/app.ts")
    for relative in required:
        if relative not in paths:
            raise FileNotFoundError(f"Candidate is missing {relative}")
    manifest = {"candidate": "loomic-creative-workspace", "files":
                {name: {"sha256": sha256(path)} for name, path in sorted(paths.items())}}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for name, path in sorted(paths.items()):
            bundle.write(path, name)
        bundle.writestr("RELEASE-MANIFEST.json", json.dumps(manifest, indent=2) + "\n")
    return sha256(destination)


def one_take_sources(source: Path) -> dict[str, Path]:
    if not (source / "apps/server/src/features/onetake/runner.py").is_file():
        return {}
    packaged = source / "apps/server/src/features/onetake/upstream"
    directory = packaged if packaged.exists() else source / "vendor/onetake"
    upstream = directory / "asr_demo.py"
    notice = directory / "README.md"
    if directory.is_symlink() or any(path.is_symlink() for path in (upstream, notice)):
        raise ValueError("Symbolic links are not allowed in OneTake source inputs.")
    if hashlib.sha256(upstream.read_bytes().replace(b"\r\n", b"\n")).hexdigest() != ONETAKE_SHA:
        raise ValueError("OneTake source does not match the reviewed revision.")
    if "Copyright (c) 2026 One Take Team" not in notice.read_text(encoding="utf-8"):
        raise ValueError("OneTake copyright notice is missing.")
    return {"apps/server/src/features/onetake/upstream/asr_demo.py": upstream,
            "apps/server/src/features/onetake/upstream/README.md": notice}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    digest = create_candidate(ROOT, args.build_root.resolve(), args.output.resolve())
    print(f"CANDIDATE {args.output.resolve()}\nSHA256 {digest}")


if __name__ == "__main__":
    main()
