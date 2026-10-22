#!/usr/bin/env python3
"""Build one native Helstera Desktop package and publish it to studio.0st.top."""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import urllib.error
import urllib.request
import uuid

import paramiko
import yaml


DOWNLOAD_ROOT = pathlib.Path("/www/helstera/apps/web/out/downloads")
TARGET_HOST = os.environ.get("HELT_DEPLOY_HOST", "23.251.32.222")
TARGET_USER = os.environ.get("HELT_DEPLOY_USER", "root")
JUMP_HOST = os.environ.get("HELT_DEPLOY_JUMP_HOST", "103.40.14.25")
JUMP_PORT = int(os.environ.get("HELT_DEPLOY_JUMP_PORT", "19198"))
JUMP_USER = os.environ.get("HELT_DEPLOY_JUMP_USER", "add")
PLATFORMS = {"windows-x64", "macos-x64", "macos-arm64", "linux-x64"}


def resolve_build_output(root: pathlib.Path, value: pathlib.Path | None) -> pathlib.Path | None:
    if value is None:
        return None
    base = root / "apps/desktop"
    return (base / value).resolve() if not value.is_absolute() else value.resolve()


def resolve_stage_path(root: pathlib.Path, value: pathlib.Path | None) -> pathlib.Path | None:
    if value is None:
        return None
    return (root / value).resolve() if not value.is_absolute() else value.resolve()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", required=True, choices=sorted(PLATFORMS))
    parser.add_argument("--skip-build", action="store_true", help="Publish existing files from apps/desktop/release")
    parser.add_argument("--direct", action="store_true", help="Connect directly to the target server")
    return parser.parse_args()


def run(command: list[str], cwd: pathlib.Path) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def pnpm_command() -> str:
    command = "pnpm.cmd" if os.name == "nt" else "pnpm"
    resolved = shutil.which(command)
    if not resolved:
        raise RuntimeError(f"{command} is required to build desktop packages")
    return resolved


def desktop_version(root: pathlib.Path) -> str:
    package = json.loads((root / "apps/desktop/package.json").read_text(encoding="utf-8"))
    version = package.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        raise RuntimeError("apps/desktop/package.json must contain a valid release version")
    return version


def ensure_native_host(target: str) -> None:
    expected = {
        "windows-x64": ("Windows", "x86_64"),
        "macos-x64": ("Darwin", "x86_64"),
        "macos-arm64": ("Darwin", "arm64"),
        "linux-x64": ("Linux", "x86_64"),
    }[target]
    actual_system = platform.system()
    actual_arch = platform.machine() or os.environ.get("PROCESSOR_ARCHITECTURE", "")
    if not actual_arch:
        platform_tag = sysconfig.get_platform().lower()
        actual_arch = "arm64" if "arm64" in platform_tag else "x86_64" if any(token in platform_tag for token in ("amd64", "x86_64")) else ""
    actual_arch = {"AMD64": "x86_64", "x64": "x86_64", "aarch64": "arm64"}.get(actual_arch, actual_arch)
    if target == "macos-x64" and actual_system == "Darwin" and actual_arch == "arm64":
        return
    if (actual_system, actual_arch) != expected:
        raise RuntimeError(f"Build {target} on its native runner; this host is {actual_system}/{actual_arch}")


def build_desktop(root: pathlib.Path, target: str, output_dir: pathlib.Path | None = None) -> None:
    ensure_native_host(target)
    pnpm = pnpm_command()
    args = {
        "windows-x64": ["--win", "nsis", "--x64"],
        "macos-x64": ["--mac", "dmg", "zip", "--x64"],
        "macos-arm64": ["--mac", "dmg", "zip", "--arm64"],
        "linux-x64": ["--linux", "AppImage", "--x64"],
    }[target]
    build_env = os.environ.copy()
    build_env.setdefault("ELECTRON_MIRROR", "https://npmmirror.com/mirrors/electron/")
    subprocess.run([pnpm, "--filter", "@helstera/shared", "build"], cwd=root, env=build_env, check=True)
    desktop_root = root / "apps/desktop"
    config_paths: list[pathlib.Path] = []

    def create_builder_config(*, portable: bool) -> pathlib.Path | None:
        config: dict[str, object] = {"extends": "./electron-builder.yml"}
        absolute_output = resolve_build_output(root, output_dir)
        if absolute_output:
            config["directories"] = {"output": str(absolute_output)}
        if portable:
            config["extraMetadata"] = {"helsteraPortable": True}
        if not absolute_output and not portable:
            return None
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".yml", dir=desktop_root, delete=False) as config_file:
            yaml.safe_dump(config, config_file, sort_keys=False)
            config_path = pathlib.Path(config_file.name)
        config_paths.append(config_path)
        return config_path

    try:
        subprocess.run([pnpm, "--filter", "@helstera/desktop", "exec", "tsc", "-p", "tsconfig.electron.json"], cwd=root, env=build_env, check=True)
        subprocess.run([pnpm, "--filter", "@helstera/desktop", "exec", "vite", "build"], cwd=root, env=build_env, check=True)
        builder = [pnpm, "--filter", "@helstera/desktop", "exec", "electron-builder"]
        base_args = [*args, "--publish", "never"]
        base_config = create_builder_config(portable=False)
        if base_config:
            base_args.extend(["--config", str(base_config)])
        subprocess.run([*builder, *base_args], cwd=root, env=build_env, check=True)
        if target == "windows-x64":
            portable_config = create_builder_config(portable=True)
            portable_args = ["--win", "zip", "--x64", "--publish", "never"]
            if portable_config:
                portable_args.extend(["--config", str(portable_config)])
            subprocess.run([*builder, *portable_args], cwd=root, env=build_env, check=True)
    finally:
        for config_path in config_paths:
            config_path.unlink(missing_ok=True)


def files_for_release(root: pathlib.Path, target: str, version: str, stage: pathlib.Path, release_dir: pathlib.Path | None = None) -> tuple[list[pathlib.Path], pathlib.Path, pathlib.Path]:
    release = release_dir or root / "apps/desktop/release"
    downloads = stage / "downloads"
    feed = stage / "updates" / target
    downloads.mkdir(parents=True)
    feed.mkdir(parents=True)

    installer_names = {
        "windows-x64": f"Helstera-{version}-Windows-x64.exe",
        "macos-x64": f"Helstera-{version}-macOS-x64.dmg",
        "macos-arm64": f"Helstera-{version}-macOS-arm64.dmg",
        "linux-x64": f"Helstera-{version}.AppImage",
    }
    installer_patterns = {
        "windows-x64": f"Helstera-Setup-{version}-Windows-x64.exe",
        "macos-x64": f"Helstera-{version}.dmg",
        "macos-arm64": f"Helstera-{version}-arm64.dmg",
        "linux-x64": "*.AppImage",
    }
    manifest_names = {
        "windows-x64": "latest.yml",
        "macos-x64": "latest-mac.yml",
        "macos-arm64": "latest-mac.yml",
        "linux-x64": "latest-linux.yml",
    }

    installer_matches = sorted(path for path in release.glob(installer_patterns[target]) if not path.name.endswith(".blockmap"))
    if len(installer_matches) != 1:
        raise RuntimeError(f"Expected one installer matching {installer_patterns[target]} in {release}")
    public_installer = downloads / installer_names[target]
    shutil.copy2(installer_matches[0], public_installer)
    portable_installer: pathlib.Path | None = None
    if target == "windows-x64":
        portable_matches = sorted(path for path in release.glob(f"*-{version}-win-x64.zip") if path.is_file())
        if len(portable_matches) != 1:
            raise RuntimeError(f"Expected one Windows portable archive for version {version} in {release}")
        portable_installer = downloads / portable_matches[0].name
        shutil.copy2(portable_matches[0], portable_installer)
    manifest = release / manifest_names[target]
    if not manifest.is_file():
        raise RuntimeError(f"Missing updater manifest: {manifest}")
    parsed_manifest = yaml.safe_load(manifest.read_text(encoding="utf-8"))
    referenced_files = {entry.get("url") for entry in parsed_manifest.get("files", []) if isinstance(entry, dict)}
    if parsed_manifest.get("path"):
        referenced_files.add(parsed_manifest["path"])
    if not referenced_files:
        raise RuntimeError(f"Updater manifest has no package paths: {manifest}")
    for name in referenced_files:
        if not isinstance(name, str) or pathlib.PurePosixPath(name).name != name or not (release / name).is_file():
            raise RuntimeError(f"Updater package referenced by {manifest} is missing: {name}")

    shutil.copy2(manifest, feed / manifest.name)
    package_files = [release / name for name in sorted(referenced_files)]
    for package in package_files:
        shutil.copy2(package, feed / package.name)
    for blockmap in release.glob("*.blockmap"):
        shutil.copy2(blockmap, feed / blockmap.name)

    checksum = hashlib.sha256(public_installer.read_bytes()).hexdigest()
    (downloads / f"SHA256SUMS-{target}.txt").write_text(f"{checksum}  {public_installer.name}\n", encoding="utf-8")
    release_manifest = downloads / f"desktop-release-{target}.json"
    release_manifest.write_text(json.dumps({
        "platform": target,
        "version": version,
        "fileName": public_installer.name,
        "sha256": checksum,
        **({
            "portableFileName": portable_installer.name,
            "portableSha256": hashlib.sha256(portable_installer.read_bytes()).hexdigest(),
        } if portable_installer else {}),
        "publishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    return [path for path in stage.rglob("*") if path.is_file()], feed / manifest.name, release_manifest


def load_host_keys(client: paramiko.SSHClient) -> None:
    known_hosts = os.environ.get("HELT_DEPLOY_KNOWN_HOSTS")
    if known_hosts:
        client.load_host_keys(known_hosts)
    else:
        client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.RejectPolicy())


def connect_target(password: str, direct: bool) -> tuple[paramiko.SSHClient, paramiko.SSHClient | None]:
    target = paramiko.SSHClient()
    load_host_keys(target)
    jump: paramiko.SSHClient | None = None
    if direct:
        target.connect(TARGET_HOST, username=TARGET_USER, password=password, timeout=20)
        return target, None

    jump = paramiko.SSHClient()
    load_host_keys(jump)
    jump.connect(JUMP_HOST, port=JUMP_PORT, username=JUMP_USER, allow_agent=True, look_for_keys=True, timeout=20)
    channel = jump.get_transport().open_channel("direct-tcpip", (TARGET_HOST, 22), ("127.0.0.1", 0), timeout=20)
    target.connect(TARGET_HOST, username=TARGET_USER, password=password, sock=channel, timeout=20)
    return target, jump


def ensure_remote_dir(sftp: paramiko.SFTPClient, path: str) -> None:
    current = pathlib.PurePosixPath("/")
    for part in pathlib.PurePosixPath(path).parts[1:]:
        current /= part
        try:
            sftp.stat(str(current))
        except OSError:
            sftp.mkdir(str(current))


def publish_files(sftp: paramiko.SFTPClient, stage: pathlib.Path, remote_stage: str, target: str, files: list[pathlib.Path], updater_manifest: pathlib.Path, release_manifest: pathlib.Path) -> None:
    remote_downloads = str(DOWNLOAD_ROOT)
    remote_feed = f"{remote_downloads}/updates/{target}"
    ensure_remote_dir(sftp, f"{remote_stage}/downloads")
    ensure_remote_dir(sftp, f"{remote_stage}/updates/{target}")
    for source in files:
        relative = source.relative_to(stage).as_posix()
        remote = f"{remote_stage}/{relative}"
        sftp.put(str(source), remote)
        if relative.startswith("downloads/"):
            destination = f"{remote_downloads}/{pathlib.PurePosixPath(relative).name}"
        else:
            destination = f"{remote_feed}/{pathlib.PurePosixPath(relative).name}"
        ensure_remote_dir(sftp, str(pathlib.PurePosixPath(destination).parent))
        if relative in {updater_manifest.relative_to(stage).as_posix(), release_manifest.relative_to(stage).as_posix()}:
            continue
        sftp.posix_rename(remote, destination)

    updater_path = updater_manifest.relative_to(stage).as_posix()
    sftp.posix_rename(f"{remote_stage}/{updater_path}", f"{remote_feed}/{updater_manifest.name}")
    release_path = release_manifest.relative_to(stage).as_posix()
    sftp.posix_rename(f"{remote_stage}/{release_path}", f"{remote_downloads}/{release_manifest.name}")


def clean_remote_stage(sftp: paramiko.SFTPClient, stage: pathlib.Path, remote_stage: str, target: str, files: list[pathlib.Path]) -> None:
    for source in files:
        try:
            sftp.remove(f"{remote_stage}/{source.relative_to(stage).as_posix()}")
        except OSError:
            pass
    for directory in (f"{remote_stage}/downloads", f"{remote_stage}/updates/{target}", f"{remote_stage}/updates", remote_stage):
        try:
            sftp.rmdir(directory)
        except OSError:
            pass


def verify_public_installer(files: list[pathlib.Path], stage: pathlib.Path) -> None:
    for source in files:
        relative = source.relative_to(stage).as_posix()
        if not relative.startswith("downloads/") or source.suffix == ".txt":
            continue
        request = urllib.request.Request(f"https://studio.0st.top/downloads/{source.name}", method="HEAD")
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status >= 400:
                    raise RuntimeError(f"Public download check failed: {source.name} returned {response.status}")
                expected_size = source.stat().st_size
                actual_size = response.headers.get("Content-Length")
                if actual_size is not None and int(actual_size) != expected_size:
                    raise RuntimeError(f"Public download size mismatch for {source.name}: expected {expected_size}, got {actual_size}")
        except urllib.error.URLError as error:
            raise RuntimeError(f"Public download check failed for {source.name}: {error}") from error


def version_compare(left: str, right: str) -> int:
    left_parts = tuple(int(part) for part in left.split("-", 1)[0].split("."))
    right_parts = tuple(int(part) for part in right.split("-", 1)[0].split("."))
    return (left_parts > right_parts) - (left_parts < right_parts)


def verify_version_is_newer(target: str, version: str) -> None:
    url = f"https://studio.0st.top/downloads/desktop-release-{target}.json"
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            current = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return
        raise RuntimeError(f"Cannot check current public desktop version: HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Cannot check current public desktop version: {error}") from error
    current_version = current.get("version") if isinstance(current, dict) else None
    if isinstance(current_version, str) and version_compare(version, current_version) <= 0:
        raise RuntimeError(f"Version {version} is not newer than the published {target} version {current_version}; bump apps/desktop/package.json first")


def release(args: argparse.Namespace) -> None:
    root = pathlib.Path(__file__).resolve().parents[1]
    version = desktop_version(root)
    release_dir = resolve_build_output(root, args.output_dir)
    stage_dir = resolve_stage_path(root, args.stage_dir)
    if not args.skip_build:
        build_desktop(root, args.platform, args.output_dir)

    stage_context = tempfile.TemporaryDirectory(prefix="helstera-desktop-release-") if not stage_dir else None
    stage = pathlib.Path(stage_context.name) if stage_context else stage_dir
    try:
        if stage_dir:
            stage.mkdir(parents=True, exist_ok=False)
        files, updater_manifest, release_manifest = files_for_release(root, args.platform, version, stage, release_dir)
        if args.dry_run:
            for file in files:
                print(file.relative_to(stage).as_posix())
            print(f"Would publish {version}, updater feed and download manifest for {args.platform}")
            return

        verify_version_is_newer(args.platform, version)

        password = os.environ.get("HELT_DEPLOY_PASSWORD")
        if not password:
            raise RuntimeError("Set HELT_DEPLOY_PASSWORD in the environment before publishing.")
        target, jump = connect_target(password, args.direct)
        remote_stage = f"{DOWNLOAD_ROOT}/.release-{uuid.uuid4().hex}"
        sftp = target.open_sftp()
        try:
            ensure_remote_dir(sftp, remote_stage)
            publish_files(sftp, stage, remote_stage, args.platform, files, updater_manifest, release_manifest)
            verify_public_installer(files, stage)
        finally:
            clean_remote_stage(sftp, stage, remote_stage, args.platform, files)
            sftp.close()
            target.close()
            if jump:
                jump.close()
        print(f"Published Helstera Desktop {version} ({args.platform}) to studio.0st.top")
    finally:
        if stage_context:
            stage_context.cleanup()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", required=True, choices=sorted(PLATFORMS))
    parser.add_argument("--skip-build", action="store_true", help="Use existing apps/desktop/release files")
    parser.add_argument("--output-dir", type=pathlib.Path, help="Write build artifacts to an isolated directory; relative paths are based on apps/desktop")
    parser.add_argument("--direct", action="store_true", help="Connect to the target server without the SSH jump host")
    parser.add_argument("--dry-run", action="store_true", help="Build and list release files without uploading")
    parser.add_argument("--stage-dir", type=pathlib.Path, help="Keep staged downloads and update feed here; relative paths are based on the repository root")
    args = parser.parse_args()
    try:
        release(args)
    except Exception as error:
        print(f"Desktop release failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
