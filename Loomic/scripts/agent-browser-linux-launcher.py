#!/usr/bin/python3
"""Drop the service account before launching a sandboxed, temporary Chromix profile."""
import os
from pathlib import Path
import pwd
import sys

ENGINE = Path(__file__).resolve().parent / "linux-x64-v155.0.8059.39/chromix/chrome"
ACCOUNT = "loomic-browser"

def main():
    identity = pwd.getpwnam(ACCOUNT)
    arguments = sys.argv[1:]
    profiles = [Path(arg.split("=", 1)[1]) for arg in arguments if arg.startswith("--user-data-dir=")]
    if len(profiles) != 1 and arguments != ["--version"]:
        raise RuntimeError("Exactly one temporary browser profile is required.")
    profile = profiles[0] if profiles else Path(identity.pw_dir)
    if profiles:
        if profile.is_symlink() or profile.parent.resolve() != Path("/tmp") or not profile.name.startswith("playwright_chromiumdev_profile-"):
            raise RuntimeError("Chromix profile must be a Playwright-owned temporary directory.")
        if profile.stat().st_uid != os.getuid():
            raise RuntimeError("Unexpected profile owner.")
        os.chown(profile, identity.pw_uid, identity.pw_gid)
    os.environ["XDG_CONFIG_HOME"] = str(profile)
    os.environ["XDG_CACHE_HOME"] = str(profile)
    os.setgroups([])
    os.setgid(identity.pw_gid)
    os.setuid(identity.pw_uid)
    os.execv(str(ENGINE), [str(ENGINE), *arguments])

if __name__ == "__main__":
    main()
