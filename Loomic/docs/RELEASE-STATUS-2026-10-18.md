# Helstera Release Status - 2026-10-18

This document describes the state published from the current checkout. It is
an engineering handoff, not a production deployment approval.

## Repository snapshot

- Remote: `https://github.com/addxiaoyi/studio.git`
- Branch: `master`
- Product directory: `Loomic`
- Runtime mode: local PostgreSQL, local filesystem storage, local sessions, and
  the local worker queue
- Production deployment: not performed by this snapshot
- Generated release archives, local probes, caches, temporary directories, and
  the unreferenced `vendor/` directory are excluded from Git

## Included work

- Creator workspace UX acceptance matrix and focused fixes for navigation,
  chat, generation approvals, job status, asset recovery, Feed state, settings,
  responsive layout, and reduced-motion behavior.
- Duplicate reference, duplicate job, and duplicate approval presentation
  guards without changing the generation request payload.
- Terminal approval state handling and rapid-submit protection.
- Video preview sizing, focus restoration, mobile navigation dismissal, and
  retryable loading/error states.
- Local runtime, media provider, job, Feed, asset lifecycle, workflow, and
  migration changes already present in the working tree.

## Verification evidence

Passed in the current local checkout before publication:

- Web typecheck.
- Full Web Vitest suite: 53 files and 201 tests.
- Server typecheck.
- Full Server Vitest suite: 87 files and 468 tests.
- Web production build.
- Signed-in workspace viewport checks at 320, 390, and 768 CSS pixels in
  Chromium and iPhone Safari.
- Focused checks for session race recovery, approval deduplication and terminal
  states, and creation draft recovery.

The wider browser suite still has known legacy-assumption failures unrelated to
the core creator-workspace checks. These include old auth mocking, an outdated
mobile label assertion, Chromium touch setup, public landing-page overflow,
and a pricing assertion that sees a disabled region button.

## Open work

The UX matrix currently records:

- 42 items as implemented and focused-tested.
- 55 items as locally improved but requiring browser or manual verification.
- 3 items as open: nested breadcrumbs, 200% zoom verification, and rendered
  light/dark contrast verification.

Provider contract probes, database migration execution, production deployment,
and real paid generation remain separate verification steps. No production
claim should be inferred from the local builds or local browser checks.

The Web build emits the existing Next.js warning that `headers`, `rewrites`,
and `redirects` are not applied when `output: export` is enabled. The build
still completes and exports all 53 routes; this warning must be addressed if
those runtime rules are required by the eventual hosting configuration.

## Continue from this snapshot

```powershell
cd Loomic
pnpm install
pnpm --filter @helstera/web typecheck
pnpm --filter @helstera/web test
pnpm --filter @helstera/web build
pnpm --filter @helstera/server typecheck
pnpm --filter @helstera/server test
```

Before any production release, run a no-billing provider contract probe,
review pending jobs and migrations, create a rollback backup, deploy
atomically, and verify health and static-asset hashes. Real billing, external
publishing, account authorization, and physical cleanup are not part of the
automated checks.
