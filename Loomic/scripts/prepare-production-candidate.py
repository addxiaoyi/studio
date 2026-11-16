"""Assemble an inspectable candidate from an isolated Web/Shared build."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
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
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
)
CREATIVE_RUNTIME_FILES = (
    "creative/fashion.mjs", "creative/fashion-LICENSE.txt", "creative/fashion-source.json",
    "creative/visualforge/entry.mjs", "creative/visualforge/browser-studio-vendor-entry.mjs",
    "creative/visualforge/browser-studio-worker.mjs", "creative/visualforge/browser-studio-transformers-entry.mjs",
    "creative/visualforge/wasi-worker-browser.mjs", "creative/visualforge/rspack.wasm32-wasi.wasm",
    "creative/visualforge/LICENSE.md", "creative/visualforge/source.json",
    "fashion-gallery/catalog.json", "fashion-gallery/LICENSE",
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


def server_runtime_manifests(source: Path) -> dict[str, bytes]:
    helper = Path(__file__).with_name("server-runtime-lock.mjs")
    generated = subprocess.run(
        ["node", str(helper), str(source.resolve())], check=True,
        stdout=subprocess.PIPE, encoding="utf-8",
    )
    manifests = json.loads(generated.stdout)
    return {f"deploy/server-runtime/{name}": content.encode("utf-8") for name, content in manifests.items()}


def entry_sha256(entry: Path | bytes) -> str:
    return hashlib.sha256(entry).hexdigest() if isinstance(entry, bytes) else sha256(entry)


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


def require_runtime_file(directory: Path, relative: str) -> Path:
    path = directory
    for part in PurePosixPath(relative).parts:
        path = path / part
        if path.is_symlink():
            raise ValueError(f"Symbolic links are not allowed in creative runtime inputs: {path}")
    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError(f"Creative runtime is missing or empty: {path}")
    return path


def fashion_asset_paths(catalog: object) -> list[str]:
    if not isinstance(catalog, list) or not catalog:
        raise ValueError("Fashion runtime catalog is empty or invalid.")
    assets: list[str] = []
    for item in catalog:
        for key in ("image", "thumb"):
            value = item.get(key) if isinstance(item, dict) else None
            if not isinstance(value, str) or not value or "\\" in value or ":" in value:
                raise ValueError(f"Fashion catalog has an invalid {key} path.")
            relative = PurePosixPath(value)
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"Fashion catalog path escapes its asset directory: {value}")
            assets.append(f"fashion-gallery/{relative}")
    return assets


def verify_archived_creative_runtime(source: Path, bundle: zipfile.ZipFile, files: dict[str, zipfile.ZipInfo]) -> None:
    prefix = "apps/web/out/"
    if not any(name.startswith(prefix) for name in files):
        return

    def require(relative: str) -> zipfile.ZipInfo:
        entry = files.get(prefix + relative)
        if entry is None or entry.file_size == 0:
            raise ValueError(f"Archived creative runtime is missing or empty: {relative}")
        return entry

    for relative in (*CREATIVE_RUNTIME_FILES, "index.html", "video/index.html", "fashion-gallery/index.html"):
        require(relative)
    pins = json.loads((source / "scripts/creative-sources.json").read_text(encoding="utf-8"))
    for name, relative in (("fashion", "creative/fashion-source.json"), ("video", "creative/visualforge/source.json")):
        provenance = json.loads(bundle.read(require(relative)))
        if not isinstance(provenance, dict) or any(provenance.get(key) != pins[name][key] for key in ("repository", "commit")):
            raise ValueError(f"Archived creative runtime does not match the pinned source: {relative}")
    for relative in fashion_asset_paths(json.loads(bundle.read(require("fashion-gallery/catalog.json")))):
        require(relative)


def verify_creative_runtime(source: Path, output: Path) -> None:
    public = source / "apps/web/public"
    for relative in CREATIVE_RUNTIME_FILES:
        require_runtime_file(public, relative)
        require_runtime_file(output, relative)

    pins = json.loads((source / "scripts/creative-sources.json").read_text(encoding="utf-8"))
    for name, relative in (("fashion", "creative/fashion-source.json"), ("video", "creative/visualforge/source.json")):
        provenance = json.loads((public / relative).read_text(encoding="utf-8"))
        if not isinstance(provenance, dict) or any(provenance.get(key) != pins[name][key] for key in ("repository", "commit")):
            raise ValueError(f"Creative runtime does not match the pinned source: {relative}")

    catalog = json.loads((public / "fashion-gallery/catalog.json").read_text(encoding="utf-8"))
    for relative in fashion_asset_paths(catalog):
        require_runtime_file(public, relative)

    # These modules load at runtime, so a successful Next build cannot prove they were exported.
    for relative in ("creative", "fashion-gallery"):
        for name, path in files_under(public / relative).items():
            exported = output / relative / name
            if not exported.is_file() or exported.is_symlink() or sha256(path) != sha256(exported):
                raise ValueError(f"Exported creative runtime differs or is missing: {relative}/{name}")


def create_candidate(source: Path, build: Path, destination: Path) -> str:
    if destination.exists():
        raise FileExistsError(destination)
    verify_build_inputs(source, build)
    verify_creative_runtime(source, build / "apps/web/out")
    paths: dict[str, Path | bytes] = {}
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
                {name: {"sha256": entry_sha256(path)} for name, path in sorted(paths.items())}}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for name, path in sorted(paths.items()):
            if isinstance(path, bytes):
                bundle.writestr(name, path)
            else:
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
