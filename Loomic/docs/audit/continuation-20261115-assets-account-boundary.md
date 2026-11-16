# Assets account boundary verification — 2026-11-15

The private assets page is remounted when either the account ID or access token changes. This clears the previous account's list, preview, selection, publication dialog and caption draft, including account changes that retain the same token value.

The remount alone did not prevent asynchronous external effects. Three new regressions reproduced these failures before the fix:

- A previous account's delayed project creation navigated the new account into the old canvas.
- A previous account's delayed file download clicked a browser download link after the account changed.
- A preview response body that finished after cleanup created an object URL that could no longer be revoked by that cleanup.

The page now checks whether its account instance remains mounted before navigation, download, further local batch saves or follow-up asset loading. Preview loaders check their abort signal after reading the response body and before creating object URLs. Already-started server mutations are not rolled back by this UI guard.

## Evidence

Working directory: `apps/web`.

```powershell
pnpm exec vitest run test/assets-account-effects.test.tsx --maxWorkers=1 --no-file-parallelism
```

Before the fix: exit 1, all 3 regressions failed on the unwanted effects. Log: `.creative-test-results/assets-account-effects-red-20261115.log`.

```powershell
pnpm exec vitest run test/assets-account-effects.test.tsx test/asset-publication-account.test.tsx test/assets-latest-request.test.tsx test/asset-preview-workflow.test.tsx test/gallery-captions.test.tsx --maxWorkers=1 --no-file-parallelism
```

After the fix: exit 0, 5 test files and 11 tests passed. Log: `.creative-test-results/assets-account-effects-green-20261115.log`.

The navigation regression also verifies that the current account can still open its own canvas. The publication regression verifies that an old publication response cannot dismiss a new account's dialog. The preview workflow verifies that retries and original private-video playback preparation still work.

Biome check with write on the two new account test files: exit 0. Scoped `git diff --check`: exit 0. This is local component coverage; it does not establish production deployment or live account-switch behavior.
