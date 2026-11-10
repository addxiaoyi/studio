# Desktop 0.2.23: local workspace and cloud copies

## Behavior

First launch opens a bundled configuration screen, even without network access. A native folder picker grants the workspace, a real write/read probe verifies it, and the user chooses whether to automatically keep cloud copies and whether to restore Agent directory access on later launches. Media, Projects and Exports subdirectories separate original files, versioned project/chat snapshots and local rendered videos. Settings can reopen configuration. Uninstall does not delete this workspace.

Cloud copies use the Electron window's authenticated session, including the site's HttpOnly login cookie. Requests are confined to the configured site and reject redirects. The renderer does not buffer the media file. Downloaded bytes are streamed into a temporary file, flushed, reread and SHA-256 checked before publishing a uniquely named final file. Account directories and a saved index keep copies distinct; existing receipts are checked against actual files before skipping. Missing files download again. Partial failures expose per-item reasons; cancellation keeps completed copies and removes the current partial file. Tokens and cookies are not stored in the backup index.

The settings panel supports explicit saving, progress, cancel, retry and opening the folder. Optional automatic copying starts after login and checks every 15 minutes while the page is visible. Cloud deletion does not delete local copies. Project snapshots include the primary canvas and its chat sessions/messages; they are backups, not a claim of a complete offline editor. Files already expired or unavailable on the server cannot be recovered by downloading.

The installer uses solid compression and excludes remaining browser-only/debug package assets. OCR cores, FFmpeg/x264, source archives and license notices remain included. Automatic updates use a complete installer with hash verification rather than differential package downloads.

## Verification

- Desktop typecheck and 169 tests passed before the final additional cancellation regression; targeted final download/setup/backup tests passed (8). Five real bundled-FFmpeg export integrations passed separately.
- Web typecheck and 13 targeted storage/settings tests passed; production static build succeeded.
- Real Electron test `apps/desktop/e2e/local-storage.mjs` requires an HttpOnly fixture cookie, exercises first launch, folder writes, 200% zoom, byte/hash equality, canvas and chat snapshot files, duplicate skipping, restarted configuration/Agent access, restored receipts and interrupted-download retry. Added to Windows CI after packaging.
- Existing packaged lifecycle regression passed offline/timeout/crash recovery, second-instance restore and persisted bounds with completed setup.
- Real production private image copied through the candidate app: cloud and local each 54,101 bytes, byte-for-byte equal, SHA-256 `e2a9ca7ffc592f8be2e371800576d52473dd9fa389972b0c5f26464d6f1d1be8`. Acceptance used the user's authorized account; no generation or paid model was invoked.
- High DPI screenshots were taken through Electron's viewport capture after zoom settled. Playwright full-page capture at Electron zoom cropped its image and is not the visual acceptance evidence. Native viewport screenshots show reachable content in light and dark modes without horizontal overflow.

Local evidence: `M:/loomic-builds/desktop-023-cookie-e2e/report.json`, `desktop-023-live-acceptance/report.json`, `desktop-023-setup-viewport.png`, `desktop-023-setup-dark.png`, `desktop-023-tests.log`, `desktop-023-web-build.log`.

Packaging, installed-app verification and production publication are recorded after the final binaries complete. macOS/Linux native installation and code signing require separate acceptance.
