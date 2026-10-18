# Local runtime architecture

The application runs against local PostgreSQL and the local filesystem. Supabase is not a runtime dependency.

Required server settings:

- `DATABASE_URL` points to the local PostgreSQL database.
- `STORAGE_ROOT` points to the local upload directory.
- `PROVIDER_CONFIG_ENCRYPTION_KEY` protects configured Provider credentials.

Authentication uses the `app_users` and `sessions` tables. The browser stores no Supabase session; it uses the HttpOnly `helstera_session` cookie issued by `/api/local-auth/*`.

Jobs use the local PostgreSQL-backed queue. The Worker, credit ledger, generation approvals, Canvas writeback, and generated assets all read and write the same local database.

Database upgrades run in two layers: `schema.sql` establishes the idempotent baseline, then `apps/server/src/local-db/migrations/*.sql` runs in filename order. Each applied file is recorded in `schema_migrations` with a SHA-256 checksum. Reusing a version with changed contents fails fast; create a new version instead. Run `pnpm --filter @helstera/server db:migrate:local` before starting a release.

The historical `supabase/` migrations and the retired mock source are kept only as migration history/reference. They are excluded from the active workspace and are not loaded by the server or Worker.
