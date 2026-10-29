"""Package a sparse Agent marketplace patch for the guarded production deployer."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import tempfile
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
OVERLAYS = (
    "apps/server/src/app.ts",
    "apps/server/src/http/website-capture.ts",
    "apps/server/src/http/agent-marketplace.ts",
    "apps/server/src/features/website-capture/assistant-hub.ts",
    "apps/server/src/local-db/migrations/20261026000000_agent_marketplace_catalog.sql",
    "apps/server/src/local-db/migrations/20261026000001_desktop_agent_recovery.sql",
    "apps/server/src/local-db/migrations/20261026000002_desktop_agent_chat_recovery.sql",
    "apps/server/src/http/agent-marketplace.ts",
    "apps/server/src/agent/workspace-skills.ts",
    "deploy/server-runtime",
    "apps/server/src/features/website-capture/assistant-hub-integration.test.ts",
    "packages/shared/dist/website-capture.js",
    "packages/shared/dist/website-capture.d.ts",
)


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_patch_archive(destination: pathlib.Path) -> tuple[str, list[str]]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="helstera-agent-marketplace-patch-") as temporary:
        stage = pathlib.Path(temporary)
        manifest: dict[str, object] = {"release": "agent-marketplace", "base": "production-live", "files": {}}
        digests: dict[str, str] = {}
        for relative in OVERLAYS:
            source = ROOT / relative
            sources = sorted(path for path in source.rglob("*") if path.is_file() and not path.is_symlink()) if source.is_dir() else [source]
            if not sources or any(not path.is_file() for path in sources):
                raise FileNotFoundError(f"Required marketplace source is missing: {source}")
            for source_file in sources:
                file_relative = source_file.relative_to(ROOT).as_posix()
                target = stage / file_relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source_file.read_bytes())
                digests[file_relative] = sha256(target)
        manifest["files"] = {name: {"sha256": digest} for name, digest in digests.items()}
        (stage / "RELEASE-MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(stage.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(stage).as_posix())

    with zipfile.ZipFile(destination) as archive:
        files = sorted(archive.namelist())
    return sha256(destination), files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=pathlib.Path, default=ROOT / "release-candidates/agent-marketplace-patch-20261026.zip")
    args = parser.parse_args()
    digest, files = create_patch_archive(args.archive.resolve())
    print(f"ARCHIVE {args.archive.resolve()}")
    print(f"SHA256 {digest}")
    print("FILES " + ",".join(files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
