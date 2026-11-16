# Public gallery recovery operations

The recovery service is public-only and independent of the main API/Worker. It is enabled explicitly with `PUBLIC_MEDIA_LOCAL_ROOT` and `PUBLIC_MEDIA_MANIFEST`; `QINIU_PUBLIC_MANIFEST` remains supported. It serves only manifest paths, verifies SHA-256 and length, preserves range and cache validators, and rejects paths escaping its root.

Production public directory: `/www/helstera/.public-media-recovery-20261116-r23`. Current runtime: `update-r2/runtime` beneath it; PM2 name: `helstera-public-media-recovery-r2`, PID 687859, port loopback 3014. r2 fixes cancellation during file I/O and owns exposed stream errors; Node 20.20.2 cancellation and live disconnect tests pass. The main public readiness endpoint still belongs to the old API. Check the recovery service separately:

```sh
curl -fsS http://127.0.0.1:3014/api/health/ready
curl -fsS https://studio.0st.top/fashion-gallery/img/SPR-0001.webp | sha256sum
```

The sample hash is `59baef4da9c4f9b32bc9e4736674fd0f6dc9055a2bbbc2f26ca5eeeb652feed5`. Full per-file evidence is in `public-postflight.json`; runtime, route, environment and PM2 receipts are adjacent. Configuration backups are private files on the production host.

The runtime pins its `node_modules` through the original recovery runtime to `/www/helstera/.releases/stability-20261110-1/apps/server/node_modules` (actual dependency tree `.server-runtime`). Keep that dependency tree until recovery is retired or receives an independently verified dependency installation. Its PM2 configuration is `update-r2/final/ecosystem.config.cjs`. The original recovery and temporary preview processes remain stopped as rollback references. Restarting uses the saved PM2 environment and verified public directory; no Qiniu credentials are needed by local mode.

## Route rollback

The route tool validates the original two proxy blocks, snapshots bytes, runs `nginx -t`, reloads and restores the snapshot if validation/reload fails. It refuses to overwrite configuration changed after its recorded cutover. Its production receipt is `nginx-route-receipt.json`.

```sh
python3 /www/helstera/.public-media-recovery-20261116-r23/update-r2/route-public-media-recovery.py \
  --receipt /www/helstera/.public-media-recovery-20261116-r23/nginx-route-receipt.json \
  --rollback
```

That restores the captured old routes. Qiniu currently rejects reads, so this would restore the old gallery outage as well. r2 additionally restores recovery routing if rollback validation/reload fails and protects concurrent configuration edits. Actual rollback was tested on an isolated loopback Nginx instance; do not run it on production merely to repeat the rehearsal. Do not blindly restore the pre-recovery environment files: they reference a deleted manifest.

## Full release and retirement

The old API/Worker have no drain receipts; a full release must address that lifecycle boundary and complete database backup, migration rehearsal and application acceptance gates. The recovery artifact being deployed does not mean the full r23 candidate is deployed.

Once a main API with local public-media support has been verified, prepare a fresh narrow routing change against the then-current Nginx configuration and application port. Recheck bytes, range/ETag, private-path rejection and user flows. Only after traffic has moved successfully should the recovery process be stopped/removed and PM2 saved. An old snapshot must not overwrite a subsequent full-release configuration; its hash guard will refuse that operation.
