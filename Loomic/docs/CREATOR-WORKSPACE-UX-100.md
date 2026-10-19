# Creator Workspace UX - 100 Acceptance Items

Status: `[x]` implemented and covered by a focused check; `[~]` present or locally improved but needs browser/manual verification; `[ ]` not implemented in this pass.

## Navigation and workspace shell

- [~] 01. Shared page titles and primary actions use a consistent hierarchy.
- [x] 02. Nested pages expose a useful breadcrumb/back path.
- [x] 03. Active routes expose `aria-current="page"`.
- [~] 04. Primary navigation remains distinct from secondary destinations.
- [~] 05. Collapsed navigation keeps accessible labels and hover titles; keyboard focus now expands the desktop sidebar, with a browser pass still pending.
- [~] 06. Route changes preserve the expanded active navigation group.
- [~] 07. Mobile navigation respects safe-area insets and has large targets.
- [x] 08. Mobile More menu closes on outside pointer, Escape, and route change.
- [~] 09. Workspace pages expose a skip-to-main link.
- [x] 10. Credit load failure has an explicit retry action.

## Home and project entry

- [~] 11. Home keeps a direct creation entry visible.
- [x] 12. Prompt attachments expose upload, validation failure, and keyboard-usable retry states; non-retryable files remain removable.
- [~] 13. Prompt submission exposes the active model mode.
- [~] 14. Generation surfaces show available cost estimates before submission.
- [x] 15. Recent-project load failure is distinct from an empty list and retryable.
- [x] 16. Project search is labeled and has a clear action.
- [x] 17. Project actions remain keyboard reachable and destructive actions use a named accessible confirmation dialog.
- [x] 18. Creation brief and type are temporarily saved in the current tab session.
- [~] 19. First-run guidance is available without blocking repeated work.
- [~] 20. Asset-to-canvas editing opens the selected asset in the editor.

## Canvas editing

- [x] 21. Empty canvas offers an accessible AI creation action and keyboard shortcut guidance.
- [x] 22. Canvas tools and layer selection expose active, pressed, and focus-visible states without nested interactive controls.
- [x] 23. Selection count and available actions are discoverable, with a focused selection-action regression check.
- [x] 24. Zoom and selection navigation remain reachable, with labelled keyboard controls and a focused regression check.
- [~] 25. Layer and canvas selection stay synchronized; the layer control now exposes its selected state, while full canvas synchronization remains to be browser-verified.
- [~] 26. Timeline open/close behavior is predictable.
- [x] 27. Video preview width and height are constrained to the viewport.
- [x] 28. Closing the video preview restores focus to the prior canvas control and is covered by a component regression test.
- [~] 29. Video controls remain usable on narrow screens and keyboard.
- [~] 30. Canvas save and sync states are visible and recoverable.

## AI chat and messages

- [x] 31. Duplicate image references in message history collapse by asset ID or URL; request payloads remain unchanged.
- [x] 32. Chat media cards remain within the message column instead of stretching the panel.
- [x] 33. Duplicate media tool blocks collapse when they reference the same Job ID.
- [x] 34. The sidebar progress item no longer hides or duplicates unrelated Job cards.
- [x] 35. Expired, canceled, completed, and terminal-failure approvals become compact non-actionable status rows.
- [~] 36. Stream connection and generation states announce progress, including the direct video path; a full screen-reader pass remains.
- [x] 37. Auto-follow stops when the reader scrolls up and offers a return-to-latest action.
- [~] 38. Retry retains the prior prompt and reference context.
- [x] 39. Attachments can be inspected and removed before sending, including keyboard-usable failure retry and remove actions.
- [x] 40. Synchronous locks prevent rapid duplicate send and approval requests.

## Image and video generation

- [~] 41. Image and video modes are distinguishable at their entry points.
- [~] 42. Incompatible capabilities are rejected before work is submitted.
- [~] 43. Automatic, manual, unavailable, and fallback model states are visible.
- [~] 44. Approval details show the selected model, parameters, references, and cost.
- [x] 45. The same approval ID renders one actionable approval card.
- [x] 46. Confirm and cancel actions are guarded against rapid duplicate clicks.
- [x] 47. Duplicate status blocks for the same Job render once.
- [~] 48. Queue, running, success, failure, and unknown outcomes have distinct copy.
- [~] 49. Retry remains disabled until the Job is confirmed retry-safe.
- [~] 50. Job timeline and recovery actions are visible in the tool detail view.

## Asset management

- [x] 51. Type filters, search, recovery view, and pagination expose their current state.
- [x] 52. Asset search can be cleared without resetting unrelated filters.
- [x] 53. Batch action bar reports selection count and page scope, covered by the Chromium asset regression.
- [x] 54. Preview tiles have stable dimensions and loading placeholders, covered at a 390px Chromium viewport.
- [x] 55. Failed previews have a retry action, covered by a failed-then-recovered preview regression.
- [x] 56. Video assets use video MIME validation and native preview controls.
- [~] 57. Bottom fade stays out of download, edit, and share controls.
- [x] 58. Asset cards show active retention or recovery-window time remaining.
- [x] 59. Soft-deleted assets have per-item and batch restore actions.
- [x] 60. Delete confirmation accurately explains the seven-day recovery window.

## Feed workflow

- [x] 61. Six-step workflow has a compact mobile navigation and desktop stepper.
- [x] 62. `packageId` and `step` restore from the URL and are covered by a deep-link regression test.
- [~] 63. Hotspot search, sort, pagination, and loading states remain visible.
- [~] 64. Custom topic creation works without selecting a hotspot.
- [~] 65. Review and automatic-draft modes stay separate.
- [x] 66. Automation status announces its current stage.
- [~] 67. Retry targets the failed automation stage and preserves edited fields.
- [~] 68. Platform variants show draft availability per selected platform.
- [~] 69. Dirty structure state blocks leaving until the user chooses.
- [~] 70. Scheduling and publishing keep explicit human confirmation.

## Creation, storyboard, and libraries

- [~] 71. Creation entry emphasizes the next useful action.
- [x] 72. Project-type choices expose selected state to assistive technology.
- [x] 73. Creation brief has a character limit and session draft recovery.
- [x] 74. Storyboard without a project offers a direct creation/recovery action, covered by the Chromium storyboard regression.
- [x] 75. Current storyboard shot is clearly indicated with `aria-current="step"` and a pressed state.
- [x] 76. Storyboard save and generation failures have explicit retry actions.
- [~] 77. Character, scene, and prop reference assets can be reused.
- [~] 78. Storyboard generation exposes model and estimated cost.
- [~] 79. Brand-kit color, font, and logo selection follows shared control states.
- [~] 80. Prompt, gallery, texture, and skill libraries expose search and empty states; e-commerce history now exposes a retryable load failure.

## Settings, collaboration, and account

- [x] 81. Profile and model-setting feedback uses status/error announcements.
- [~] 82. Agent chat model and media-generation model settings are distinct.
- [x] 83. Paid-generation auto-approval states its billing effect, uses an associated description, and saves with feedback.
- [~] 84. Publishing account connection and revoke states are visible.
- [~] 85. Billing, top-up, and credit usage share clear navigation; pricing region selection is now touchable/keyboard-reachable with explicit international-channel status, while the full billing journey remains to be audited.
- [x] 86. Usage history has loading, empty, and retryable error states.
- [x] 87. Team invite button is locked during submission; member-list failures expose a retry action and search remains recoverable.
- [x] 88. Skill install, enablement, and version states are distinguishable, and catalog failures expose a retry action.
- [x] 89. Authentication failures preserve an internal return path through login; external redirect targets are rejected.
- [x] 90. Settings tabs support arrow/Home/End navigation and tab-panel semantics.

## Responsive, accessibility, and resilience

- [~] 91. The signed-in workspace shell and More menu pass at 320, 390, and 768 CSS pixels in Chromium and iPhone Safari; asset, Feed, and canvas detail layouts still need per-page browser checks.
- [~] 92. Workspace chrome now reflows and wraps at reduced CSS viewport widths; the Chromium UX-100 test passes at a 640 CSS-pixel 200% proxy, while a manual browser-zoom pass remains.
- [~] 93. Primary workspace controls are keyboard reachable and the desktop sidebar expands on focus; complete end-to-end keyboard audit remains.
- [~] 94. Dialogs use the shared accessible primitive; video preview restores focus.
- [~] 95. Semantic contrast tokens and a `prefers-contrast: more` fallback now cover shared chrome; Chromium verifies foreground and muted text AA in light/dark themes, while all control/error pairs remain to be measured.
- [x] 96. CSS and Framer Motion honor `prefers-reduced-motion`.
- [~] 97. Primary lists have loading skeletons and explicit empty states.
- [~] 98. Network failures preserve user input and offer targeted retry where implemented; usage history now distinguishes failed loading from an empty result.
- [x] 99. Session/message and Feed polling ignore or stop stale asynchronous updates.
- [~] 100. Key progress and outcome changes use atomic status/alert semantics; full screen-reader pass remains.

## Verification

- `pnpm --filter @helstera/web typecheck`
- `pnpm --filter @helstera/web test`
- `pnpm --filter @helstera/web build`
- `pnpm --filter @helstera/web exec playwright test e2e/ux100.spec.ts --project=chromium`
- Browser checks at desktop/mobile, reduced motion, keyboard-only, and 200% zoom are still required for unchecked visual/accessibility items.

This pass also adds route-aware document titles, nested workspace breadcrumbs with a
parent back path, narrow-viewport wrapping for shared chrome, and stronger semantic
tokens when the user requests increased contrast. Chat streaming now announces
connection and direct-generation phases, and keyboard focus expands the desktop
sidebar so its labels remain visible while navigating without a pointer.
