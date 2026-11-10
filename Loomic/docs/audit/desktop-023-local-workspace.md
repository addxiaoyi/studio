# Desktop 0.2.23: local workspace and cloud copies

## Behavior

First launch opens a bundled configuration screen, even without network access. A native folder picker grants the workspace, a real write/read probe verifies it, and the user chooses whether to automatically keep cloud copies and whether to restore Agent directory access on later launches. Media, Projects and Exports subdirectories separate original files, versioned project/chat snapshots and local rendered videos. Settings can reopen configuration. Uninstall does not delete this workspace.

Cloud copies use the Electron window's authenticated session, including the site's HttpOnly login cookie. Requests are confined to the configured site and reject redirects. The renderer does not buffer the media file. Downloaded bytes are streamed into a temporary file, flushed, reread and SHA-256 checked before publishing a uniquely named final file. Account directories and a saved index keep copies distinct; existing receipts are checked against actual files before skipping. Missing files download again. Partial failures expose per-item reasons; cancellation keeps completed copies and removes the current partial file. Tokens and cookies are not stored in the backup index.

The settings panel supports explicit saving, progress, cancel, retry and opening the folder. Optional automatic copying starts after login and checks every 15 minutes while the page is visible. Cloud deletion does not delete local copies. Project snapshots include the primary canvas and its chat sessions/messages; they are backups, not a claim of a complete offline editor. Files already expired or unavailable on the server cannot be recovered by downloading.

The installer uses solid compression and excludes remaining browser-only/debug package assets. OCR cores, FFmpeg/x264, source archives and license notices remain included. Automatic updates use a complete installer with hash verification rather than differential package downloads.

## Verification

- Desktop typecheck and final suite: 171 passed, 9 optional/environment-dependent tests skipped. Targeted download/setup/backup tests passed (8). Five real bundled-FFmpeg export integrations passed separately.
- Web typecheck and 14 targeted storage/settings tests passed, including automatic-backup opt-in and unmount cancellation; production static build succeeded.
- Real Electron test `apps/desktop/e2e/local-storage.mjs` requires an HttpOnly fixture cookie, exercises first launch, folder writes, 200% zoom, byte/hash equality, canvas and chat snapshot files, duplicate skipping, restarted configuration/Agent access, restored receipts and interrupted-download retry. Added to Windows CI after packaging.
- Existing packaged lifecycle regression passed offline/timeout/crash recovery, second-instance restore and persisted bounds with completed setup.
- Real production private image copied through the candidate app: cloud and local each 54,101 bytes, byte-for-byte equal, SHA-256 `e2a9ca7ffc592f8be2e371800576d52473dd9fa389972b0c5f26464d6f1d1be8`. Acceptance used the user's authorized account; no generation or paid model was invoked.
- Real production private video: cloud/local each 238,134 bytes, SHA-256 `9867ff576a5cf43811f8589d9ac16d3559dac3baa3e74a97387b1cfb499fc7e9`. Local FFprobe and full decode passed: VP8/Opus, 1280×720, 5.02 seconds.
- The final installer was installed under a separate test App ID. Its installed app.asar matches the released payload, and the complete native storage test passed again from the installed executable. Earlier reinstall/uninstall checks preserved the profile and workspace. Final optional cleanup was rejected by automatic approval review (`blocked by policy`); the isolated acceptance installation and test directories remain.
- Production settings UI passed 1280/960/720 window widths without horizontal overflow. The native page shows the workspace, storage mode, saved/verified/failed counts, open-folder and retry actions. There is one authoritative directory configuration; legacy asset-folder controls are hidden in the new desktop.
- Fixed startup navigation recovery after the real UI test found that an intentionally aborted startup load could replace a newer navigation with an offline page. Regression failed before the change and passed afterward; packaged lifecycle and local storage tests were repeated on the final binary.
- High DPI screenshots were taken through Electron's viewport capture after zoom settled. Playwright full-page capture at Electron zoom cropped its image and is not the visual acceptance evidence. Native viewport screenshots show reachable content in light and dark modes without horizontal overflow.

Local evidence: `M:/loomic-builds/desktop-023-cookie-e2e/report.json`, `desktop-023-live-acceptance/report.json`, `desktop-023-setup-viewport.png`, `desktop-023-setup-dark.png`, `desktop-023-tests.log`, `desktop-023-web-build.log`.

## Final Windows delivery

Published 0.2.23 with matching download and updater manifests. Installer: 95,690,509 bytes (91.3 MiB), down 18.3% from 0.2.22's 111.7 MiB and 29.5% from the 0.2.21 baseline. Portable: 95,556,054 bytes. Unpacked payload: 357,266,771 bytes (340.7 MiB).

- Installer SHA-256: `8ee55c95f2f8ef3df84394cb2ad2fe1af7dab2a15659909956e0f3dd69807fbf`.
- Portable SHA-256: `7523a6ceacf79634c3135e3fe95f6182857c293be2691d1913dfe0510add40e7`.
- Web deployment preserves all managed desktop downloads; the final directory-control adjustment used a verified 707,934-byte delta and atomic directory exchange. No Server or database change was required.
- Public download verification, updater hashes and version: `M:/loomic-builds/desktop-023-public-verification.json`. Native final installed test: `desktop-023-exact-installed-storage/report.json`. Production UI: `desktop-023-live-acceptance/ui-report.json`.
- Implementation: `96a235b`, `53a0071`, `d2a7e45`. Latest implementation CI runs `42741838228` (desktop) and `42741838216` (Agent) were still running at publication; superseded implementation runs were canceled. Previous 0.2.22 three-platform CI `42733310558` completed successfully. These are distinct from this release's Windows local acceptance.

macOS/Linux native installation and code signing require separate acceptance. Local project snapshots are readable JSON backup files; restoring them into an editable canvas is not implemented in this release.
