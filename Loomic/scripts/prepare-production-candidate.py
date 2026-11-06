"""Assemble an inspectable candidate from an isolated Web/Shared build."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ONETAKE_SHA = "9b002bd9f3245cd89446dbcd094059e4899d59851316b71186d3dea93f0a9b29"
INPUT_TREES = ("apps/web/src", "packages/shared/src")
INPUT_FILES = (
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
    "apps/web/package.json", "apps/web/next.config.ts", "apps/web/postcss.config.mjs", "apps/web/tsconfig.json",
    "packages/shared/package.json", "packages/shared/tsconfig.json",
)
INCLUDE_TREES = (
    ("apps/server/src", "source"),
    ("deploy/server-runtime", "source"),
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
            if relative == "deploy/server-runtime" and name.startswith("packages/shared/dist/"):
                continue
            paths[f"{relative}/{name}"] = path
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
                "deploy/server-runtime/pnpm-lock.yaml", "apps/server/src/app.ts")
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
    upstream = source / "vendor/onetake/asr_demo.py"
    notice = source / "vendor/onetake/README.md"
    if sha256(upstream) != ONETAKE_SHA:
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
