from __future__ import annotations

import argparse
import pathlib
import re
import sys


STORYBOARD_RSC_PATH = "/storyboard/index.txt"
PRIVATE_VIDEO_PATH = "/api/assets/private-video"


def validate_config(config: str) -> list[str]:
    errors: list[str] = []
    root_location = re.compile(r"location\s+/\s*\{(?P<body>.*?)\}", re.DOTALL)
    for match in root_location.finditer(config):
        for directive in re.findall(r"\btry_files\s+([^;]+);", match.group("body")):
            if directive.split()[-1:] == ["/index.html"]:
                errors.append("The root location falls back to /index.html, returning HTTP 200 for missing routes")
    exact_location = re.compile(
        r"location\s*=\s*/storyboard/index\.txt\s*\{(?P<body>.*?)\}",
        re.DOTALL,
    )

    for match in exact_location.finditer(config):
        body = match.group("body")
        if re.search(r"\breturn\s+30[1278]\b", body):
            errors.append(
                f"{STORYBOARD_RSC_PATH} must be served as a static RSC payload, not redirected"
            )
        if re.search(r"\breturn\s+404\b", body):
            errors.append(
                f"{STORYBOARD_RSC_PATH} must not be blocked; Next navigation depends on it"
            )

    broad_txt_block = re.compile(
        r"location\s+~\*?\s+[^\{]*\\?\.txt[^\{]*\{(?P<body>.*?)\}",
        re.DOTALL,
    )
    for match in broad_txt_block.finditer(config):
        body = match.group("body")
        if re.search(r"\breturn\s+(?:30[1278]|404)\b", body) and "/_next/" not in match.group(0):
            errors.append(
                "A broad .txt location blocks Next static-export RSC payloads; scope it to /_next/ only"
            )

    return errors


def validate_private_video_upload(config: str) -> list[str]:
    exact_location = re.compile(
        r"location\s*=\s*/api/assets/private-video\s*\{(?P<body>[^{}]*)\}",
        re.DOTALL,
    )
    matches = list(exact_location.finditer(config))
    if len(matches) != 1:
        return [f"{PRIVATE_VIDEO_PATH} requires exactly one dedicated upload location"]
    body = re.sub(r"#[^\n]*", "", matches[0].group("body"))
    errors: list[str] = []
    sizes = re.findall(r"\bclient_max_body_size\s+(\d+)([kKmMgG]?)\s*;", body)
    multipliers = {"": 1, "k": 1024, "m": 1024**2, "g": 1024**3}
    if len(sizes) != 1 or int(sizes[0][0]) * multipliers[sizes[0][1].lower()] < 251 * 1024**2:
        errors.append("Private video upload must allow at least 251 MiB including multipart overhead")
    if not re.search(r"\bproxy_request_buffering\s+off\s*;", body):
        errors.append("Private video upload must disable proxy request buffering")
    if not re.search(r"\bproxy_http_version\s+1\.1\s*;", body):
        errors.append("Private video upload must use HTTP/1.1 upstream")
    if not re.search(r"\bproxy_pass\s+http://127\.0\.0\.1:3000\s*;", body):
        errors.append("Private video upload must proxy the original URI to the local server")
    return errors


def prepare_studio_config(config: str) -> str:
    root_location = re.compile(r"(location\s+/\s*\{)(?P<body>[^{}]*)(\})", re.DOTALL)
    roots = list(root_location.finditer(config))
    if len(roots) != 1:
        raise ValueError("Expected exactly one root location")
    root = roots[0]
    directive = re.compile(r"(\btry_files\s+[^;]*?)(/index\.html|=404)(\s*;)")
    updated_body, changes = directive.subn(r"\g<1>=404\g<3>", root.group("body"))
    if changes != 1:
        raise ValueError("Expected one recognized root try_files directive")
    config = config[:root.start("body")] + updated_body + config[root.end("body"):]

    exact_upload = re.compile(r"location\s*=\s*/api/assets/private-video\s*\{")
    if not exact_upload.search(config):
        api_locations = list(re.finditer(r"(?m)^(?P<indent>[ \t]*)location\s+/api/\s*\{", config))
        if len(api_locations) != 1:
            raise ValueError("Expected exactly one general API proxy location")
        marker = api_locations[0]
        indent = marker.group("indent")
        lines = (
            "location = /api/assets/private-video {",
            "    client_max_body_size 251m;",
            "    proxy_request_buffering off;",
            "    proxy_http_version 1.1;",
            "    proxy_pass http://127.0.0.1:3000;",
            "    proxy_set_header Host $host;",
            "    proxy_set_header X-Real-IP $remote_addr;",
            "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
            "    proxy_set_header X-Forwarded-Proto $scheme;",
            "    proxy_connect_timeout 30s;",
            "    proxy_send_timeout 3600s;",
            "    proxy_read_timeout 3600s;",
            "}",
        )
        insert = "\n".join(indent + line for line in lines) + "\n\n"
        config = config[:marker.start()] + insert + config[marker.start():]
    errors = validate_config(config) + validate_private_video_upload(config)
    if errors:
        raise ValueError("; ".join(errors))
    return config


def prepare_assistant_websocket(config: str) -> str:
    if re.search(r"location\s+/api/website-capture/assistant/ws\s*\{", config):
        return config
    api_locations = list(re.finditer(r"(?m)^(?P<indent>[ \t]*)location\s+/api/\s*\{", config))
    if len(api_locations) != 1:
        raise ValueError("Expected exactly one general API proxy location")
    marker = api_locations[0]
    indent = marker.group("indent")
    lines = (
        "location /api/website-capture/assistant/ws {",
        "    proxy_pass http://127.0.0.1:3000;",
        "    proxy_http_version 1.1;",
        "    proxy_set_header Upgrade $http_upgrade;",
        '    proxy_set_header Connection "upgrade";',
        "    proxy_set_header Host $host;",
        "    proxy_set_header X-Real-IP $remote_addr;",
        "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
        "    proxy_set_header X-Forwarded-Proto $scheme;",
        "    proxy_read_timeout 3600s;",
        "    proxy_send_timeout 3600s;",
        "}",
    )
    return config[:marker.start()] + "\n".join(indent + line for line in lines) + "\n\n" + config[marker.start():]


def prepare_creative_isolation(config: str) -> str:
    marker = "    # Loomic native video editor isolation."
    locations = (("= /video", "/video/index.html"), ("^~ /video/", "$uri $uri/"), ("^~ /creative/", "$uri"))
    # Location-level add_header disables inheritance on older Nginx releases.
    security = []
    for name, default in (("X-Content-Type-Options", '"nosniff"'),
                          ("X-Frame-Options", '"SAMEORIGIN"'),
                          ("Referrer-Policy", '"strict-origin-when-cross-origin"'),
                          ("Strict-Transport-Security", None),
                          ("Content-Security-Policy", None),
                          ("Permissions-Policy", None)):
        matches = re.findall(r"\badd_header\s+" + re.escape(name) + r"\s+([^;]+);", config, re.IGNORECASE)
        value = matches[0].strip() if matches else default
        if value:
            if not value.endswith(" always"):
                value += " always"
            security.append(f"        add_header {name} {value};\n")
    blocks = []
    for location, files in locations:
        blocks.append(f"    location {location} {{\n"
                      + ('        gzip_static on;\n        gzip_vary on;\n' if location == "^~ /creative/" else '') +
                      '        add_header Cross-Origin-Opener-Policy "same-origin" always;\n'
                      '        add_header Cross-Origin-Embedder-Policy "credentialless" always;\n'
                      '        add_header Cache-Control "no-cache" always;\n'
                      + "".join(security) +
                      '        types { text/javascript mjs js; application/wasm wasm; text/html html; text/css css; application/json json; text/plain txt; }\n'
                      f"        try_files {files} =404;\n    }}")
    insert = marker + "\n" + "\n".join(blocks) + "\n"
    if marker in config:
        if insert not in config:
            legacy = insert.replace('        gzip_static on;\n        gzip_vary on;\n', '')
            if legacy not in config:
                raise ValueError("Video isolation configuration differs; review before replacing")
            return config.replace(legacy, insert, 1)
        return config
    if re.search(r"location\s+(?:=\s*|\^~\s*)?/(?:video(?:/|\s)|creative/)", config):
        raise ValueError("Existing video location needs manual isolation review")
    roots = list(re.finditer(r"(?m)^[ \t]*location\s+/\s*\{", config))
    if len(roots) != 1:
        raise ValueError("Expected one root location before enabling video isolation")
    offset = roots[0].start()
    return config[:offset] + insert + config[offset:]


def prepare_public_media(config: str) -> str:
    marker = "    # Verified public gallery reads from Qiniu over signed HTTPS."
    if marker in config:
        return config
    roots = list(re.finditer(r"(?m)^[ \t]*root /www/helstera/apps/web/out;", config))
    if len(roots) != 1:
        raise ValueError("Expected one production static root before enabling public media")
    insert = """
    # Verified public gallery reads from Qiniu over signed HTTPS.
    location ^~ /fashion-gallery/img/ {
        proxy_pass http://127.0.0.1:3000/api/public-media/fashion-gallery/img/;
        proxy_set_header Host $host;
        proxy_set_header Authorization "";
        proxy_set_header Cookie "";
        proxy_buffering off;
        proxy_read_timeout 180s;
    }
    location ^~ /fashion-gallery/thumbs/ {
        proxy_pass http://127.0.0.1:3000/api/public-media/fashion-gallery/thumbs/;
        proxy_set_header Host $host;
        proxy_set_header Authorization "";
        proxy_set_header Cookie "";
        proxy_buffering off;
        proxy_read_timeout 180s;
    }
"""
    offset = roots[0].end()
    return config[:offset] + "\n" + insert + config[offset:]


def main() -> int:
    parser = argparse.ArgumentParser(description="Reject Nginx rules that break Next RSC navigation")
    parser.add_argument("config", type=pathlib.Path)
    parser.add_argument("--video-uploads", action="store_true", help="Also check the private video upload proxy.")
    args = parser.parse_args()

    config = args.config.read_text(encoding="utf-8")
    errors = validate_config(config)
    if args.video_uploads:
        errors.extend(validate_private_video_upload(config))
    if errors:
        for error in errors:
            print(f"NGINX_GUARD_ERROR: {error}", file=sys.stderr)
        return 1

    print("NGINX_GUARD_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
