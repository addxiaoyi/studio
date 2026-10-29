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

The script validates each updater package against the manifest's size and SHA-512, refuses to overwrite an equal or older public version, uploads into a unique temporary directory through SFTP, moves package files into place, and publishes the updater manifest last. It then checks public content types and sizes. Installers are placed in `/www/helstera/apps/web/out/downloads/`; update feeds are placed in `updates/<platform>-<arch>/` below it.

Use `--skip-build --repair-current` only to restore missing files for the currently published version. The public package hash must match the local build, and at least one public asset must be missing or invalid. A same-version repair leaves the website's desktop download manifest unchanged. Web static releases preserve these desktop-managed downloads.

```powershell
python scripts/release-desktop.py --platform windows-x64 --skip-build --repair-current
```

The Windows portable ZIP stores application data in the current user's profile and is updated by downloading and extracting the next archive. Windows NSIS and Linux AppImage installations can update automatically. macOS automatic replacement requires a Developer ID code signature; signing is not configured, so Mac users must install releases manually from the download page.

## Code Signing

Windows packages are published **unsigned** today. The build prints `no signing info identified, signing is skipped`, so a first install triggers a SmartScreen "unknown publisher" warning. Nothing in the build is broken — a certificate has never been provisioned.

To sign, provide an OV/EV Windows code-signing certificate on the build machine. Electron Builder picks these up automatically; no config change is needed:

```powershell
$env:CSC_LINK = "C:\secure\helstera-codesign.pfx"   # file path, base64 blob, or https URL
$env:CSC_KEY_PASSWORD = "<pfx password>"
python scripts/release-desktop.py --platform windows-x64
```

On a private build machine the certificate may also live in the Windows certificate store, in which case set `CSC_NAME` to its subject name instead of `CSC_LINK`.

Verify the signature before publishing — a build that silently skips signing must not be treated as signed:

```powershell
Get-AuthenticodeSignature .\apps\desktop\release\Helstera-Setup-<version>-Windows-x64.exe |
  Format-List Status, StatusMessage, SignerCertificate
```

`Status` must be `Valid`. `NotSigned` means the certificate was not picked up.

EV certificates still need a few weeks of SmartScreen reputation before the warning disappears; OV certificates inherit reputation from the account.

## Publishing Without The Script

`scripts/release-desktop.py` requires a working Python installation with `paramiko` and `PyYAML`. If it cannot run, publish by hand in this order so the public state is never half-updated:

1. Build with `electron-builder --win nsis zip --x64 --publish never` in `apps/desktop`.
2. Upload the installer and portable ZIP to `downloads/`, and the `Setup` installer plus `.blockmap` plus `latest.yml` to `downloads/updates/windows-x64/`.
3. Upload `desktop-release-windows-x64.json` and `SHA256SUMS-windows-x64.txt` **last**, after the binaries are in place.
4. Verify by downloading the public installer and comparing its SHA-256 against the manifest, and its SHA-512 against `latest.yml`.

Retain the previous release as a rollback target; older versions may be deleted from `downloads/` and `downloads/updates/<platform>-<arch>/` once superseded. Missing files under `/downloads/` must return 404, not the SPA shell — the site has a dedicated `location /downloads/` block for this.

