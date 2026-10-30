#!/usr/bin/env python3
"""Publish only the exported Web tree to the Helstera production host."""

from __future__ import annotations

import argparse
import base64
import hashlib
import html.parser
import inspect
import json
import os
import pathlib
import shlex
import ssl
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

import paramiko


DEFAULT_JUMP_HOST = "103.40.14.25"
DEFAULT_JUMP_PORT = 19198
DEFAULT_JUMP_USER = "add"
DEFAULT_TARGET_HOST = "23.251.32.222"
DEFAULT_TARGET_USER = "root"
DEFAULT_ROOT = "/www/helstera"
DEFAULT_VERIFY_URL = "https://studio.0st.top/desktop-app/"
MAX_SOURCE_FILES = 60_000
MAX_SOURCE_BYTES = 2_000_000_000
REQUIRED_FILES = (
    pathlib.PurePosixPath("out/index.html"),
    pathlib.PurePosixPath("out/marketplace/index.html"),
    pathlib.PurePosixPath("out/desktop/index.html"),
    pathlib.PurePosixPath("out/canvas/index.html"),
    pathlib.PurePosixPath("out/desktop-app/index.html"),
    pathlib.PurePosixPath("out/desktop-app/marketplace/index.html"),
)
DESKTOP_MARKERS = ("HELSTERA DESKTOP / AGENT", "desktop-browser-connection")
MARKETPLACE_MARKER = "HELSTERA / AGENT MARKETPLACE"


def configure_ssh(client: paramiko.SSHClient) -> None:
    client.load_system_host_keys()
    pinned_hosts = pathlib.Path(__file__).with_name("production-known-hosts")
    if not pinned_hosts.is_file():
        raise FileNotFoundError(f"Pinned production host keys are missing: {pinned_hosts}")
    client.load_host_keys(str(pinned_hosts))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())


class ScriptSources(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.sources: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "script":
            return
        src = dict(attrs).get("src")
        if src:
            self.sources.append(src)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Atomically publish only apps/web/out; never restarts API or Worker services."
    )
    parser.add_argument("--source", type=pathlib.Path, default=pathlib.Path("apps/web/out"))
    parser.add_argument("--password-env", default="HELT_DEPLOY_PASSWORD")
    parser.add_argument("--jump-host", default=DEFAULT_JUMP_HOST)
    parser.add_argument("--jump-port", type=int, default=DEFAULT_JUMP_PORT)
    parser.add_argument("--jump-user", default=DEFAULT_JUMP_USER)
    parser.add_argument("--target-host", default=DEFAULT_TARGET_HOST)
    parser.add_argument("--target-user", default=DEFAULT_TARGET_USER)
    parser.add_argument("--verify-url", default=DEFAULT_VERIFY_URL)
    parser.add_argument("--resume-stage")
    parser.add_argument("--resume-backup")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def validate_source(source: pathlib.Path) -> pathlib.Path:
    if source.is_symlink():
        raise ValueError("The Web export must not be a symlink.")
    root = source.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("The Web export must be a real directory, not a symlink.")
    for relative in REQUIRED_FILES:
        target = root.joinpath(*relative.parts[1:])
        if not target.is_file() or target.is_symlink():
            raise FileNotFoundError(f"Required static export file is missing: {target}")
    static_dir = root / "_next" / "static"
    if not static_dir.is_dir():
        raise FileNotFoundError(f"Next.js static assets are missing: {static_dir}")
    return root


def validate_local_desktop_bundle(source: pathlib.Path) -> None:
    desktop_html = (source / "desktop-app" / "index.html").read_text("utf-8")
    parser = ScriptSources()
    parser.feed(desktop_html)
    script_text: list[str] = []
    for src in parser.sources:
        relative = urllib.parse.urlparse(src).path.lstrip("/")
        if not relative.startswith("_next/static/"):
            continue
        script_text.append((source / relative).read_text("utf-8"))
    bundle = "\n".join(script_text)
    missing = [marker for marker in DESKTOP_MARKERS if marker not in bundle]
    if missing:
        raise ValueError(f"The desktop Web bundle is missing expected features: {', '.join(missing)}")


def validate_local_web_marketplace_bundle(source: pathlib.Path) -> None:
    marketplace_html = (source / "marketplace" / "index.html").read_text("utf-8")
    parser = ScriptSources()
    parser.feed(marketplace_html)
    script_text: list[str] = []
    for src in parser.sources:
        relative = urllib.parse.urlparse(src).path.lstrip("/")
        if relative.startswith("_next/static/"):
            script_text.append((source / relative).read_text("utf-8"))
    if MARKETPLACE_MARKER not in "\n".join(script_text):
        raise ValueError("The Web marketplace bundle is missing its marketplace page module.")


def create_archive(source: pathlib.Path, destination: pathlib.Path) -> str:
    file_count = 0
    source_bytes = 0
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"Symlinks are not allowed in the Web export: {path}")
            if path.is_file():
                file_count += 1
                source_bytes += path.stat().st_size
                if file_count > MAX_SOURCE_FILES or source_bytes > MAX_SOURCE_BYTES:
                    raise ValueError("The Web export exceeds the static release size limits.")
                archive.write(path, pathlib.PurePosixPath("out", *path.relative_to(source).parts))
    return hashlib.sha256(destination.read_bytes()).hexdigest().upper()


def preserve_managed_downloads(live_out: pathlib.Path, candidate_out: pathlib.Path) -> int:
    source = live_out / "downloads"
    if not source.is_dir():
        return 0
    if any(path.name.startswith(".release-") and path.is_dir() for path in source.iterdir()):
        raise RuntimeError("A desktop package release is in progress; retry the Web publish after it finishes.")

    destination = candidate_out / "downloads"
    copied = 0
    for path in source.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Symlinks are not allowed in the managed downloads tree: {path}")
        if not path.is_file():
            continue
        relative = path.relative_to(source)
        is_update_feed = relative.parts[0] == "updates"
        is_release_artifact = path.name.startswith(("Helstera-", "desktop-release-", "SHA256SUMS-"))
        if not (is_update_feed or is_release_artifact):
            continue

        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if not target.is_file() or target.is_symlink():
                raise RuntimeError(f"Candidate downloads path is not a regular file: {target}")
            target.unlink()
        os.link(path, target)
        copied += 1
    return copied


def remote_run(client: paramiko.SSHClient, command: str, timeout: int = 90) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    status = stdout.channel.recv_exit_status()
    if status != 0:
        raise RuntimeError(error[-3000:] or output[-3000:] or f"Remote command failed with status {status}.")
    return output.strip()


def remote_python(client: paramiko.SSHClient, source: str, timeout: int = 180) -> str:
    encoded = base64.b64encode(source.encode("utf-8")).decode("ascii")
    command = f"python3 -c {shlex.quote('import base64; exec(base64.b64decode(' + repr(encoded) + '))')}"
    return remote_run(client, command, timeout)


def open_public_url(request: urllib.request.Request, timeout: int):
    attempts = 3
    for attempt in range(attempts):
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            if error.code < 500 or attempt == attempts - 1:
                raise
        except (urllib.error.URLError, TimeoutError, ssl.SSLError):
            if attempt == attempts - 1:
                raise
        time.sleep(attempt + 1)
    raise RuntimeError("Public release verification exhausted its retry limit.")


def validate_stage_path(web_root: pathlib.PurePosixPath, value: str) -> pathlib.PurePosixPath:
    stage = pathlib.PurePosixPath(value)
    if stage.parent != web_root or not stage.name.startswith(".helstera-static."):
        raise RuntimeError("Remote staging directory was outside the approved Web directory.")
    return stage


def verify_public_desktop(url: str, cache_key: str) -> dict[str, object]:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("The desktop verification URL must use HTTPS.")
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query.append(("release_check", cache_key))
    check_url = urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(query), "")
    )
    request = urllib.request.Request(check_url, headers={"Cache-Control": "no-cache"})
    with open_public_url(request, timeout=25) as response:
        if response.status != 200:
            raise RuntimeError(f"Production desktop page returned HTTP {response.status}.")
        page = response.read(2_000_000).decode("utf-8", "replace")
        parser = ScriptSources()
        parser.feed(page)
        js_parts: list[str] = []
        for src in parser.sources:
            script_url = urllib.parse.urljoin(check_url, src)
            script_parts = urllib.parse.urlsplit(script_url)
            if script_parts.scheme != "https" or script_parts.hostname != parsed.hostname:
                raise RuntimeError("Desktop page referenced a script outside the production HTTPS origin.")
            script_query = urllib.parse.parse_qsl(script_parts.query, keep_blank_values=True)
            script_query.append(("release_check", cache_key))
            script_url = urllib.parse.urlunsplit(
                (script_parts.scheme, script_parts.netloc, script_parts.path, urllib.parse.urlencode(script_query), "")
            )
            with open_public_url(
                urllib.request.Request(script_url, headers={"Cache-Control": "no-cache"}), timeout=20
            ) as script_response:
                js_parts.append(script_response.read(8_000_000).decode("utf-8", "replace"))
        bundle = "\n".join(js_parts)
        missing = [marker for marker in DESKTOP_MARKERS if marker not in bundle]
        if missing:
            raise RuntimeError(f"Production desktop bundle is missing expected features: {', '.join(missing)}")
        marketplace_url = urllib.parse.urljoin(response.url, "marketplace/")
        with open_public_url(urllib.request.Request(marketplace_url, headers={"Cache-Control": "no-cache"}), timeout=20) as marketplace_response:
            if marketplace_response.status != 200:
                raise RuntimeError("Production desktop marketplace route did not return HTTP 200.")
            marketplace_parser = ScriptSources()
            marketplace_parser.feed(marketplace_response.read(2_000_000).decode("utf-8", "replace"))
            marketplace_parts: list[str] = []
            for src in marketplace_parser.sources:
                script_url = urllib.parse.urljoin(marketplace_url, src)
                script_parts = urllib.parse.urlsplit(script_url)
                if script_parts.scheme != "https" or script_parts.hostname != parsed.hostname:
                    raise RuntimeError("Desktop marketplace referenced a script outside the production HTTPS origin.")
                script_query = urllib.parse.parse_qsl(script_parts.query, keep_blank_values=True)
                script_query.append(("release_check", cache_key))
                script_url = urllib.parse.urlunsplit(
                    (script_parts.scheme, script_parts.netloc, script_parts.path, urllib.parse.urlencode(script_query), "")
                )
                with open_public_url(urllib.request.Request(script_url, headers={"Cache-Control": "no-cache"}), timeout=20) as script_response:
                    marketplace_parts.append(script_response.read(8_000_000).decode("utf-8", "replace"))
            if MARKETPLACE_MARKER not in "\n".join(marketplace_parts):
                raise RuntimeError("Production desktop marketplace route loaded without its marketplace module.")
        web_marketplace_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/marketplace/", "", ""))
        web_query = urllib.parse.parse_qsl(urllib.parse.urlsplit(web_marketplace_url).query, keep_blank_values=True)
        web_query.append(("release_check", cache_key))
        web_marketplace_check = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/marketplace/", urllib.parse.urlencode(web_query), ""))
        with open_public_url(urllib.request.Request(web_marketplace_check, headers={"Cache-Control": "no-cache"}), timeout=20) as web_marketplace_response:
            if web_marketplace_response.status != 200:
                raise RuntimeError("Production Web marketplace route did not return HTTP 200.")
            web_marketplace_parser = ScriptSources()
            web_marketplace_parser.feed(web_marketplace_response.read(2_000_000).decode("utf-8", "replace"))
            web_marketplace_parts: list[str] = []
            for src in web_marketplace_parser.sources:
                script_url = urllib.parse.urljoin(web_marketplace_check, src)
                script_parts = urllib.parse.urlsplit(script_url)
                if script_parts.scheme != "https" or script_parts.hostname != parsed.hostname:
                    raise RuntimeError("Web marketplace referenced a script outside the production HTTPS origin.")
                script_query = urllib.parse.parse_qsl(script_parts.query, keep_blank_values=True)
                script_query.append(("release_check", cache_key))
                script_url = urllib.parse.urlunsplit((script_parts.scheme, script_parts.netloc, script_parts.path, urllib.parse.urlencode(script_query), ""))
                with open_public_url(urllib.request.Request(script_url, headers={"Cache-Control": "no-cache"}), timeout=20) as script_response:
                    web_marketplace_parts.append(script_response.read(8_000_000).decode("utf-8", "replace"))
            if MARKETPLACE_MARKER not in "\n".join(web_marketplace_parts):
                raise RuntimeError("Production Web marketplace route loaded without its marketplace module.")
        return {"status": response.status, "url": response.url, "marketplaceUrl": marketplace_url, "scriptCount": len(parser.sources), "marketplaceScriptCount": len(marketplace_parser.sources), "webMarketplaceUrl": web_marketplace_url, "webMarketplaceScriptCount": len(web_marketplace_parser.sources)}


def deploy(args: argparse.Namespace) -> None:
    if bool(args.resume_stage) != bool(args.resume_backup):
        raise ValueError("--resume-stage and --resume-backup must be supplied together.")
    source = validate_source(args.source)
    validate_local_desktop_bundle(source)
    validate_local_web_marketplace_bundle(source)
    password = os.environ.get(args.password_env)
    if not args.dry_run and not password:
        raise RuntimeError(f"Missing deployment password environment variable: {args.password_env}")

    with tempfile.TemporaryDirectory(prefix="helstera-web-static-") as temporary:
        archive_path = pathlib.Path(temporary) / "web-out.zip"
        archive_hash = create_archive(source, archive_path)
        print(json.dumps({"source": str(source), "archiveBytes": archive_path.stat().st_size, "sha256": archive_hash}))
        if args.dry_run:
            return

        jump = paramiko.SSHClient()
        configure_ssh(jump)
        target = paramiko.SSHClient()
        configure_ssh(target)
        backup_path: str | None = None
        stage_path: str | None = None
        exchanged = False
        stage_out: str | None = None
        try:
            jump.connect(
                args.jump_host,
                port=args.jump_port,
                username=args.jump_user,
                allow_agent=True,
                look_for_keys=True,
                timeout=15,
            )
            transport = jump.get_transport()
            if transport is None or not transport.is_active():
                raise RuntimeError("SSH jump host did not establish an active transport.")
            channel = transport.open_channel("direct-tcpip", (args.target_host, 22), ("127.0.0.1", 0), timeout=15)
            target.connect(
                args.target_host,
                username=args.target_user,
                password=password,
                sock=channel,
                timeout=20,
                allow_agent=False,
                look_for_keys=False,
            )

            web_root = pathlib.PurePosixPath(DEFAULT_ROOT) / "apps" / "web"
            live_path = web_root / "out"
            backup_root = pathlib.PurePosixPath(DEFAULT_ROOT) / "backups"
            remote_run(target, f"test -d {shlex.quote(str(live_path))} && test ! -L {shlex.quote(str(live_path))}")
            if args.resume_stage:
                stage_path = str(validate_stage_path(web_root, args.resume_stage))
                backup_path = str(pathlib.PurePosixPath(args.resume_backup))
                expected_backup_root = backup_root
                actual_backup = pathlib.PurePosixPath(backup_path)
                if actual_backup.parent != expected_backup_root or not actual_backup.name.startswith("web-static-"):
                    raise ValueError("Resume backup path is outside the approved backup directory.")
                remote_run(
                    target,
                    f"test -f {shlex.quote(backup_path + '/out.tar.gz')} && test -f {shlex.quote(str(pathlib.PurePosixPath(stage_path) / 'candidate.zip'))} && test -f {shlex.quote(str(pathlib.PurePosixPath(stage_path) / 'out/desktop-app/index.html'))}",
                )
                archive_remote = str(pathlib.PurePosixPath(stage_path) / "candidate.zip")
            else:
                timestamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
                backup_path = str(backup_root / f"web-static-{timestamp}-{archive_hash[:10]}")
                stage_path = remote_run(
                    target,
                    f"mkdir -p {shlex.quote(str(backup_root))} && mktemp -d {shlex.quote(str(web_root / '.helstera-static.XXXXXX'))}",
                )
                stage_path = str(validate_stage_path(web_root, stage_path))
                archive_remote = str(pathlib.PurePosixPath(stage_path) / "candidate.zip")
                sftp = target.open_sftp()
                try:
                    sftp.put(str(archive_path), archive_remote)
                finally:
                    sftp.close()

            uploaded_hash = remote_run(target, f"sha256sum {shlex.quote(archive_remote)} | cut -d' ' -f1").upper()
            if uploaded_hash != archive_hash:
                raise RuntimeError("Uploaded Web archive SHA-256 does not match the local candidate.")

            stage = pathlib.PurePosixPath(stage_path)
            archive_remote = str(stage / "candidate.zip")
            stage_out = str(stage / "out")
            marker_name = ".helstera-static-release"
            if not args.resume_stage:
                extract = f"""
import os, pathlib, stat, zipfile
archive = {archive_remote!r}
stage = pathlib.Path({str(stage)!r}).resolve(strict=True)
with zipfile.ZipFile(archive) as bundle:
    for entry in bundle.infolist():
        name = pathlib.PurePosixPath(entry.filename)
        if name.is_absolute() or any(part in ('..', '') for part in name.parts) or not name.parts or name.parts[0] != 'out':
            raise ValueError('Unsafe path in Web archive: ' + entry.filename)
        mode = entry.external_attr >> 16
        if stat.S_ISLNK(mode):
            raise ValueError('Symlinks are not allowed in the Web archive.')
        target = (stage / pathlib.Path(*name.parts)).resolve()
        if stage not in target.parents and target != stage:
            raise ValueError('Web archive path escapes its staging directory.')
    bundle.extractall(stage)
candidate = stage / 'out'
required = ['index.html', 'marketplace/index.html', 'desktop/index.html', 'desktop-app/index.html', 'desktop-app/marketplace/index.html', 'canvas/index.html', '_next/static']
for item in required:
    if not (candidate / item).exists():
        raise FileNotFoundError('Web candidate is incomplete: ' + item)
print(candidate)
"""
                extracted = remote_python(target, extract, timeout=180)
                if pathlib.PurePosixPath(extracted) != pathlib.PurePosixPath(stage_out):
                    raise RuntimeError("Remote extractor returned an unexpected staging path.")

                preserve_source = inspect.getsource(preserve_managed_downloads)
                preserve = (
                    "import json, os, pathlib\n"
                    + preserve_source
                    + "\nprint(json.dumps({'preservedFiles': preserve_managed_downloads("
                    + "pathlib.Path(" + repr(str(live_path)) + ")"
                    + ", "
                    + "pathlib.Path(" + repr(stage_out) + ")"
                    + ")}))"
                )
                print("DOWNLOADS", remote_python(target, preserve), flush=True)

                backup = f"""
import pathlib, tarfile
source = pathlib.Path({str(live_path)!r})
destination = pathlib.Path({backup_path!r})
destination.mkdir(parents=True, exist_ok=False)
with tarfile.open(destination / 'out.tar.gz', 'w:gz') as archive:
    archive.add(source, arcname='out', recursive=True)
with tarfile.open(destination / 'out.tar.gz', 'r:gz') as archive:
    if not any(item.name == 'out/desktop/index.html' or item.name == 'out/desktop-app/index.html' for item in archive):
        raise RuntimeError('Backup archive verification failed.')
print(destination)
"""
                remote_python(target, backup, timeout=600)

            verify_candidate = f"""
from html.parser import HTMLParser
from pathlib import Path
class Scripts(HTMLParser):
    def __init__(self): super().__init__(); self.src=[]
    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            src = dict(attrs).get('src')
            if src: self.src.append(src)
root = Path({stage_out!r})
parser = Scripts()
parser.feed((root / 'desktop-app/index.html').read_text(encoding='utf-8'))
bundle = '\\n'.join((root / src.lstrip('/')).read_text(encoding='utf-8') for src in parser.src if src.startswith('/_next/static/'))
required = {list(DESKTOP_MARKERS)!r}
missing = [marker for marker in required if marker not in bundle]
if missing: raise RuntimeError('Staged desktop bundle is missing: ' + ', '.join(missing))
web_parser = Scripts()
web_parser.feed((root / 'marketplace/index.html').read_text(encoding='utf-8'))
web_bundle = '\\n'.join((root / src.lstrip('/')).read_text(encoding='utf-8') for src in web_parser.src if src.startswith('/_next/static/'))
if {MARKETPLACE_MARKER!r} not in web_bundle: raise RuntimeError('Staged Web marketplace bundle is missing its page module.')
print('candidate-features-ok')
"""
            remote_python(target, verify_candidate, timeout=90)

            exchange = f"""
import ctypes, os, pathlib
marker = pathlib.Path({stage_out!r}) / {marker_name!r}
marker.write_text({archive_hash!r}, encoding='ascii')
renameat2 = getattr(ctypes.CDLL(None, use_errno=True), 'renameat2', None)
if renameat2 is None:
    raise RuntimeError('Linux renameat2 is unavailable; refusing non-atomic replacement.')
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
result = renameat2(-100, os.fsencode({stage_out!r}), -100, os.fsencode({str(live_path)!r}), 2)
if result != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error))
print('atomic-exchange-ok')
"""
            try:
                remote_python(target, exchange)
                exchanged = True
            except Exception:
                marker_check = f"""
from pathlib import Path
marker = Path({str(live_path)!r}) / {marker_name!r}
print('exchanged' if marker.is_file() and marker.read_text(encoding='ascii') == {archive_hash!r} else 'not-exchanged')
"""
                try:
                    exchanged = remote_python(target, marker_check) == "exchanged"
                except Exception:
                    raise RuntimeError(
                        "The atomic switch outcome is unknown; preserve the staging directory and backup for recovery."
                    )
                if not exchanged:
                    raise

            public = verify_public_desktop(args.verify_url, archive_hash[:16])
            remove_marker = f"from pathlib import Path\n(Path({str(live_path)!r}) / {marker_name!r}).unlink(missing_ok=True)"
            remote_python(target, remove_marker)
            exchanged = False
            print(json.dumps({"publicVerification": public, "backup": backup_path, "sha256": archive_hash}))
            cleanup = f"import pathlib, shutil\nshutil.rmtree(pathlib.Path({stage_path!r}))"
            try:
                remote_python(target, cleanup, timeout=90)
                stage_path = None
            except Exception as cleanup_error:
                print(f"CLEANUP_WARNING: staging directory retained at {stage_path}: {cleanup_error}")
        except Exception:
            if exchanged:
                rollback = f"""
import ctypes, os
renameat2 = getattr(ctypes.CDLL(None, use_errno=True), 'renameat2', None)
if renameat2 is None:
    raise RuntimeError('Cannot roll back atomically: renameat2 is unavailable.')
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
result = renameat2(-100, os.fsencode({stage_out!r}), -100, os.fsencode({str(live_path)!r}), 2)
if result != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error))
print('rollback-exchange-ok')
"""
                remote_python(target, rollback)
                exchanged = False
            raise
        finally:
            if stage_path:
                if target.get_transport() and target.get_transport().is_active():
                    if not exchanged:
                        cleanup = f"import pathlib, shutil\nshutil.rmtree(pathlib.Path({stage_path!r}), ignore_errors=True)"
                        try:
                            remote_python(target, cleanup, timeout=90)
                        except Exception as cleanup_error:
                            print(f"CLEANUP_WARNING: staging directory retained at {stage_path}: {cleanup_error}")
            if target.get_transport() and target.get_transport().is_active():
                target.close()
            if jump.get_transport() and jump.get_transport().is_active():
                jump.close()


if __name__ == "__main__":
    deploy(parse_args())
