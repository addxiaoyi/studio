"""Read the active PM2 source and Nginx route without changing host state."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


PUBLIC_MEDIA_PORT = "3014"
LOCAL_UPSTREAM = re.compile(r"http://127\.0\.0\.1:(\d+)(?=[/;\s])")
GALLERY_PATHS = {f"/{prefix}fashion-gallery/{kind}/"
                 for prefix in ("", "api/public-media/") for kind in ("img", "thumbs")}
GALLERY_LOCATION = re.compile(
    r"\blocation\s+\^~\s+(?P<path>/(?:api/public-media/)?fashion-gallery/(?:img|thumbs)/)"
    r"\s*\{(?P<body>[^{}]*)\}")
SHARED_RESOLUTION = ("import {fileURLToPath} from 'node:url'; "
                     "process.stdout.write(JSON.stringify(fileURLToPath(import.meta.resolve('@helstera/shared'))));")


def api_ports(config: str) -> set[str]:
    content = re.sub(r"#[^\n]*", "", config)
    locations = list(GALLERY_LOCATION.finditer(content))
    if any(PUBLIC_MEDIA_PORT in LOCAL_UPSTREAM.findall(match["body"]) for match in locations):
        if len(locations) != len(GALLERY_PATHS) or {match["path"] for match in locations} != GALLERY_PATHS:
            raise RuntimeError("Nginx public gallery sidecar requires exactly the four reviewed locations")
        for match in locations:
            target = f"http://127.0.0.1:{PUBLIC_MEDIA_PORT}"
            if match["path"].startswith("/fashion-gallery/"):
                target += "/api/public-media" + match["path"]
            proxies = [value.strip() for value in re.findall(r"\bproxy_pass\s+([^;]+);", match["body"])]
            if proxies != [target] or LOCAL_UPSTREAM.findall(match["body"]) != [PUBLIC_MEDIA_PORT]:
                raise RuntimeError("Nginx public gallery sidecar has an unreviewed upstream")
        content = GALLERY_LOCATION.sub("", content)
    ports = set(LOCAL_UPSTREAM.findall(content))
    if PUBLIC_MEDIA_PORT in ports:
        raise RuntimeError("Nginx has an unreviewed public media upstream outside the gallery sidecar")
    return ports


def resolve_shared(root: Path, cwd: Path) -> Path:
    try:
        command = subprocess.run(["node", "--input-type=module", "-e", SHARED_RESOLUTION], cwd=cwd,
                                 check=True, capture_output=True, text=True, timeout=30)
        resolved = json.loads(command.stdout)
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Active API shared dependency could not be resolved") from error
    if not isinstance(resolved, str) or not Path(resolved).is_absolute():
        raise RuntimeError("Active API shared entry must resolve to an absolute filesystem path")
    try:
        entry = Path(resolved).resolve(strict=True)
    except OSError as error:
        raise RuntimeError("Active API shared entry is missing or unreadable") from error
    if not entry.is_relative_to(root):
        raise RuntimeError("Active API shared dependency is outside the deployment root")
    if not entry.is_file() or entry.name != "index.js" or entry.parent.name != "dist":
        raise RuntimeError("Active API shared entry is not a recognized dist/index.js")
    try:
        manifest = (entry.parent.parent / "package.json").resolve(strict=True)
        if not manifest.is_relative_to(root):
            raise RuntimeError("Active API shared package manifest is outside the deployment root")
        package = json.loads(manifest.read_bytes())
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Active API shared package does not have a readable @helstera/shared manifest") from error
    if not isinstance(package, dict) or package.get("name") != "@helstera/shared":
        raise RuntimeError("Active API shared package is not named @helstera/shared")
    return entry.parent


def inspect(root: Path, config: Path, processes: list[dict] | None = None) -> dict:
    root = root.resolve(strict=True)
    content = re.sub(r"#[^\n]*", "", config.read_text(encoding="utf-8"))
    ports = api_ports(content)
    roots = set(re.findall(r"\broot\s+([^;]+);", content))
    if len(ports) != 1 or len(roots) != 1:
        raise RuntimeError("Expected one reviewed Nginx API port and static root")
    port = int(ports.pop())
    web = Path(roots.pop())
    if not web.is_absolute() or not web.resolve(strict=True).is_relative_to(root):
        raise RuntimeError("Nginx web root is outside the deployment root")
    if processes is None:
        command = subprocess.run(["pm2", "jlist"], check=True, capture_output=True, text=True, timeout=30)
        processes = json.loads(command.stdout)

    def online(kind):
        matches = [item for item in processes if re.fullmatch(r"helstera-" + kind + r"(?:-[A-Za-z0-9_-]+)?", item.get("name", ""))
                   and item.get("pm2_env", {}).get("status") == "online"]
        if len(matches) != 1:
            raise RuntimeError("Expected one active " + kind + " process; inspect PM2 topology")
        return matches[0]

    api, worker = online("server"), online("worker")
    cwd = Path(api["pm2_env"]["pm_cwd"]).resolve(strict=True)
    if cwd.name != "server" or cwd.parent.name != "apps":
        raise RuntimeError("Active API does not use a recognized apps/server working directory")
    if Path(worker["pm2_env"]["pm_cwd"]).resolve(strict=True) != cwd:
        raise RuntimeError("Active API and worker do not use the same immutable release")
    source = cwd.parent.parent
    if not source.is_relative_to(root):
        raise RuntimeError("Active API source is outside the deployment root")
    shared = resolve_shared(root, cwd)
    active = {"api": api["name"], "worker": worker["name"], "port": port, "web": str(web), "release": str(source)}
    state_file = root / ".active-release.json"
    state_bytes = state_file.read_bytes() if state_file.exists() else None
    if state_bytes:
        state = json.loads(state_bytes)
        if any(state.get(key) != value for key, value in active.items()):
            raise RuntimeError("Release pointer disagrees with Nginx or PM2; inspect host state")
    return {"source": str(source), "web": str(web), "shared": str(shared), "active": active,
            "stateSha256": hashlib.sha256(state_bytes).hexdigest() if state_bytes else None}


if __name__ == "__main__":
    print(json.dumps(inspect(Path(sys.argv[1]), Path(sys.argv[2]))))
