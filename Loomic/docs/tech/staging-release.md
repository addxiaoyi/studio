# Staging Release Procedure

The release helper is `scripts/staging-release.ps1`. It is deliberately non-deploying by default.

Validate a candidate archive:

```powershell
pwsh -File scripts/staging-release.ps1 -ArchivePath .codex-release\helstera-staging-candidate.zip -Mode validate
```

Run a local filesystem rehearsal with backup and static checks:

```powershell
pwsh -File scripts/staging-release.ps1 -ArchivePath .codex-release\helstera-staging-candidate.zip -Mode rehearse
```

A real staging deployment requires explicit `STAGING_DEPLOY_ROOT`, `STAGING_HEALTH_URL`, and `-ConfirmDeploy`. The helper keeps a timestamped backup, switches the `current` directory only after staging the release, checks `index.html`, Next static assets, the release manifest and migration, then runs the health URL. Any failed check restores the previous directory.

This repository currently has no staging target or credentials configured. Do not point the helper at production without a separate approved rollout and rollback window.
