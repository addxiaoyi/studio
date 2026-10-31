# Agent workspace implementation checkpoint

Updated: 2026-10-31. Local implementation only; not a production release.

## Latest continuation: website report delivery

- Background URL capture now returns a validated Markdown document with title, safe filename, source URLs and the existing evidence-based introduction. This is a sourced website report, not general topic search or an LLM research engine.
- Document content persists in the goal/task result; output metadata stays `pending` / `pending_local` until actual local delivery exists. No document is mislabeled as an image asset or a saved local file. No new database migration was needed for this JSON result extension.
- The canvas Agent panel restores the report from the API and offers a localized Markdown download with an explicit not-auto-saved message and recoverable error state. Existing screenshot/video canvas insertion remains; the document is not yet an editable canvas text element.
- Capture retry keys include the attempt task ID, avoiding the previous unique-key conflict. Capture success is recorded after canvas delivery, not before it. Each canvas write rechecks goal/task state; already committed evidence is not claimed to be rolled back.
- Pausing releases the read-only executor and records that resume restarts the current capture. A paused goal does not redispatch until explicitly resumed. This avoids blocking the serial worker indefinitely; it is not checkpoint-based crash recovery, and prior evidence may remain when a capture is restarted.
- Background recording/video requests fail closed until an exact action approval path exists. Existing desktop task approvals remain the recording entry point.
- Checks: Shared 193, Server 781, Web 525, Desktop 85 tests passed; four package typechecks passed. Five opt-in real PostgreSQL scenarios passed separately, including document persistence and pause/resume without an orphan running task. Capture/browser execution is mocked in these tests.
- Shared build/runtime sync and Web production export (67 pages) passed. No production publish, installed-app download test, browser visual/keyboard acceptance, or automatic local file delivery is claimed.

The next vertical slice is document-to-native-folder delivery with a real saved-file acknowledgement and retry state. General structured planning, exact goal approvals, evidence checkpoints and native crash recovery remain release blockers.

## Latest continuation: Windows native execution bridge

- Added a Windows UI Automation helper process under `apps/desktop/native/`. It is a standalone x64 C++17 executable using the Windows SDK, packaged as an Electron `extraResource`.
- The helper inspects only the current foreground window, limits the control tree, reports safe control metadata, refuses sensitive labels/password controls, verifies the HWND and PID before writing, and uses `IUIAutomationValuePattern` for ordinary uniquely named edit fields.
- Electron uses the helper on Windows x64 when available and falls back to the existing nut.js/OCR path on other platforms or when the helper is absent. Existing credential filtering, approval checks, DPI coordinate conversion and task serialization remain in force.
- Native keyboard modifier release now runs in a `finally` path and reports a hard error if a modifier could not be released, avoiding a stuck key after a failed action.
- Build entry points: `pnpm --filter @helstera/desktop build:native` and the desktop `prebuild` hook. The helper compiled successfully on this machine and returned protocol version 1. Desktop Electron typecheck and Vite renderer/main/preload build passed.
- A full installed-app task run was not performed. The browser action path still uses the existing Electron DOM executor; the new native bridge does not claim to replace browser automation.

## Follow-up continuation: packaged native bridge and browser action checks

- Windows NSIS and portable x64 artifacts built successfully for desktop `0.2.19`. The unpacked package contains `resources/native/helstera-uia.exe`; runtime path selection uses `process.resourcesPath` when packaged and the app resource directory in development.
- Browser click/fill actions in the website capture task path now use a single DOM validator/executor. It rejects ambiguous, hidden, disabled, covered or credential-like controls, waits briefly for late DOM content, dispatches input/change events, verifies the resulting value, and returns the error to the action result event.
- Native backend availability is explicit: Windows UIA, macOS Accessibility permission requirement, Linux AT-SPI/X11 path, and Wayland unsupported status. This is capability detection and protocol planning; macOS/Linux native acceptance has not been run.
- Desktop Electron typecheck, Vite main/preload/renderer build, native C++ helper build/probe, installer build, package resource check and `git diff --check` passed.
- Native UIA evidence now stores the foreground window title and sanitized control metadata in the desktop task event result, so the server timeline can restore the control snapshot after refresh. Browser action results continue through the existing action event and approval records.
- Windows real-device acceptance completed: the portable candidate launched, Notepad's `Document` editing control was discovered and received `Loomic UIA test`, and reuse after switching to Helstera was rejected with `Target window changed.` The helper now supports both Edit and Document controls and uses separate traversal/response limits.
- Local Server was started at `http://127.0.0.1:3001`. Its first worker tick exposed that the local database had not received the Agent Goal migrations; both `20261031000000_agent_muse_workspace.sql` and `20261031000001_agent_suggestion_context.sql` were applied to the loopback database. Subsequent worker ticks no longer emitted the missing `output_kind` error.
- Added native permission probing and IPC: Windows reports UIA ready; macOS probes Accessibility through System Events and Screen Recording through `screencapture`; Linux checks X11/Wayland and the AT-SPI2 session bus. The desktop settings surface reports backend, permission state and setup reason. Unsupported or unprobed platforms remain unavailable for native actions.
- Checks: Desktop native automation 17 tests, Web desktop settings 3 tests, Desktop/Web typechecks and `git diff --check` passed. macOS/Linux probes were not executed on this Windows host.

## Verified this pass

- Confirmed goals without tasks can be dispatched. Draft and suggestion-only goals cannot execute.
- Confirmation and its event use one SQL statement. Pause/resume and cancel/retry cannot turn an unconfirmed draft into executable work.
- A dedicated PostgreSQL connection holds a per-goal advisory lock while processing. State is reread after acquiring the lock.
- Completion state, outputs, completion event, chat message, and preference learning commit together. Persistence errors roll back completion for retry.
- Worker status synchronization cannot overwrite paused or canceled goals.
- Legacy goal/task responses receive defaults for new fields. Web Agent API payloads are validated before rendering.
- Workspace goals are canvas-scoped; selection survives remount in the same browser tab. API failures are visible and completed summaries are rendered.
- Enabling a connector no longer fabricates connection health. Desktop readiness checks the authenticated user's live, unpaused desktop socket.
- Suggestion acceptance locks the owner-scoped row and creates the draft goal in the same transaction. Expired pending suggestions are rejected; accepted retries return the existing goal. Execution mode and output type are retained by a new additive migration.
- Parent goals and memory context are owner/workspace scoped. Memory editing allows only supported structured preferences, not free-form credential-bearing text.
- Native folder selection now returns its correct kind and writes/reads/removes a real probe before saving configuration. Folder status is read from the main process, with free space, last write, unavailable-directory feedback, and open/clear actions. Clearing configuration does not remove user assets. Explicit local saves refuse overwriting existing names.
- Canceled background tasks no longer emit a false completion event. Goal-level events omit absent task IDs so real database responses pass the shared schema.

## Checks

- Shared build and deployment shared-dist sync passed.
- Web production static export passed (67 pages). Desktop renderer/main/preload bundles passed via `vite build`; this is not a new installer or update release.
- Server, Web, Desktop typechecks passed.
- Previous Shared checkpoint: 186 passed. This pass: Server 771 passed; Web 521 passed; Desktop 85 passed. Additional targeted storage UI checks cover native path/free-space display and opening the folder.
- `git diff --check` passed.
- Real PostgreSQL 17 integration: 4 scenarios passed in a newly created temporary database. All migration SQL files applied on a fresh schema, feature migrations replayed successfully, and tests covered draft gating, concurrent confirmation/worker dispatch, one-time output/chat persistence, transaction failure/recovery with a new worker, suggestion rollback/concurrent acceptance, cancellation, and shared response parsing. Executors are controlled test doubles; no paid or external actions run. The temporary databases were removed afterward.
- Docker remains unavailable, but the existing local Windows PostgreSQL service is usable. Existing application and production databases were not migrated.
- No production migration, deployment, installer rebuild, authenticated browser acceptance, or real desktop execution was performed.

Run the isolated PostgreSQL suite from `apps/server` with `HELT_AGENT_DB_TEST=1` and:
`node --env-file=../../.env.local ./node_modules/vitest/vitest.mjs run src/features/agent-goals/agent-goal-postgres.test.ts`.
It refuses non-loopback database hosts, creates a uniquely named `helstera_agent_test_*` database, and removes only that database after the suite. The configured role needs temporary database creation permission. Without the opt-in flag the four integration scenarios are skipped in ordinary unit runs.

## Remaining release gates

1. Repeat migrations on a restored production-schema backup and run authenticated end-to-end execution. Fresh-database tests do not establish compatibility with production drift.
2. Replace static read-only planning with general connector execution. Side-effect plans currently wait for approval but do not yet create a precise actionable goal approval by themselves.
3. Complete memory extraction, deletion/suppression semantics, and cross-canvas suggestion navigation. Current safe editing is intentionally limited to enumerated structured preferences.
4. Enforce built-in connector permission revocation in execution, validate selected connector and memory ownership, and verify installed MCP/Skill/Plugin registration end to end.
5. Verify the native folder flow in the installed Electron app; complete automatic local result delivery, output previews, retention, and desktop notifications. The disk-probe tests are not installer acceptance.
6. Complete the unified shell, centralized translations, cross-device goal restoration, feature-flag rollout, and light/dark/narrow-screen runtime checks.
7. Test crash recovery during a running background executor. The advisory lock prevents concurrent processing; it does not by itself resume an interrupted executor or guarantee exactly-once external side effects.

Preserve existing untracked installers, caches, learning directories, and outer-workspace recovery artifacts. Do not stage them with feature changes.
