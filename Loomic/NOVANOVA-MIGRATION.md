# Novanova Studio migration ledger

This migration is intentionally incremental. Existing Loomic authentication,
database, task execution, and deployment paths remain authoritative until each
replacement has passing tests and runtime evidence.

## Order

1. Frontend creation experience: canvas, asset library, generation history,
   Agent panel.
2. Model capability configuration and provider templates.
3. Video workflows and asynchronous task state.
4. Credits, storage, notifications, and administration.

## First phase mapping

| Novanova source area | Loomic target | Status |
| --- | --- | --- |
| `web/src/features/canvas/domain` | `apps/web/src/lib/canvas-*` and canvas components | existing canvas retained; typechecked |
| `web/src/features/assets` | `apps/web/src/components/canvas-files-panel.tsx` and asset APIs | canvas panel links to gallery/history |
| `web/src/features/canvas/components/canvas-agent-*` | `apps/web/src/components/agent-section.tsx` | selected canvas context reaches Agent input |
| `web/src/features/canvas/services` | Loomic canvas persistence and job APIs | not copied; contract alignment pending |

Direct directory copying is unsafe because Novanova depends on Java/Spring APIs,
Redis Stream events, and different domain schemas. Each increment must be
rewritten for Loomic Fastify/TypeScript contracts and verified independently.
