from __future__ import annotations

import argparse
import pathlib
import re
import sys


STORYBOARD_RSC_PATH = "/storyboard/index.txt"


def validate_config(config: str) -> list[str]:
    errors: list[str] = []
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Reject Nginx rules that break Next RSC navigation")
    parser.add_argument("config", type=pathlib.Path)
    args = parser.parse_args()

    config = args.config.read_text(encoding="utf-8")
    errors = validate_config(config)
    if errors:
        for error in errors:
            print(f"NGINX_GUARD_ERROR: {error}", file=sys.stderr)
        return 1

    print("NGINX_GUARD_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
