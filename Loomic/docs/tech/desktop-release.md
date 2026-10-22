# Desktop Release

The desktop updater contacts only `https://studio.0st.top/downloads/updates/<platform>-<arch>/`. Build and publish packages from private native build machines with `scripts/release-desktop.py`; GitHub Actions and GitHub Releases are not part of the release path.

## Prepare

Install the script dependencies and provide the production SSH password through the environment. The default route uses the existing SSH jump host. Both host keys must already exist in `known_hosts`, or provide a dedicated file with `HELT_DEPLOY_KNOWN_HOSTS`.

```powershell
python -m pip install -r scripts/requirements-desktop-release.txt
$env:HELT_DEPLOY_PASSWORD = "<production server password>"
```

Override connection endpoints with `HELT_DEPLOY_HOST`, `HELT_DEPLOY_USER`, `HELT_DEPLOY_JUMP_HOST`, `HELT_DEPLOY_JUMP_PORT`, and `HELT_DEPLOY_JUMP_USER`. Use `--direct` only when the target server is reachable without the jump host.

## Build And Publish

Run the script on the matching native operating system. Each machine builds and publishes its own package; Windows builds a portable ZIP and an NSIS installer. Extract the ZIP and launch `Helstera.exe` without installing; installed users retain in-app updates. macOS can build Intel and Apple Silicon packages separately.

Electron runtime binaries are fetched from the configured `npmmirror.com` Electron mirror, not GitHub. Set `ELECTRON_MIRROR` to an internally hosted compatible mirror on private build machines if external mirror access is not desired. npm packages still use the package registry configured by pnpm.

```powershell
python scripts/release-desktop.py --platform windows-x64
python scripts/release-desktop.py --platform macos-x64
python scripts/release-desktop.py --platform macos-arm64
python scripts/release-desktop.py --platform linux-x64
```

Use `--dry-run` to build and list the files without uploading. Use `--output-dir release-candidates/0.2.1` to keep a candidate build separate from existing releases, or `--skip-build --output-dir release-candidates/0.2.1` to use a previously built candidate.

The script checks every filename referenced by the generated updater manifest, refuses to overwrite an equal or older public version, uploads into a unique temporary directory through SFTP, moves package files into place, and publishes the updater manifest last. It then checks the public installer URL and its content length. Installers are placed in `/www/helstera/apps/web/out/downloads/`; update feeds are placed in `updates/<platform>-<arch>/` below it.

The Windows portable ZIP stores application data in the current user's profile and is updated by downloading and extracting the next archive. Windows NSIS and Linux AppImage installations can update automatically. macOS automatic replacement requires a Developer ID code signature; signing is not configured, so Mac users must install releases manually from the download page.
