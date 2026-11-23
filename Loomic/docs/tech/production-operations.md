# Production backup and monitoring

Scripts live in `scripts/ops_*.py` and `scripts/ops-runtime.mjs`. Copy `ops-config.example.json` to the host, set its release/runtime path, and protect the configuration with mode 0600. Python needs `requirements-ops.txt`; Node uses the deployed server's existing `pg`, S3 and mail libraries. Secrets are read from the existing server environment file and never included in command arguments or normal output.

## Backup and recovery

`ops_backup.py --config /www/helstera/ops/config.json` creates a PostgreSQL custom dump, verifies its table of contents, and packages the dump, environment, Nginx configuration, server source and uploaded media. AES-256-GCM encrypts the archive with a fresh key/nonce; RSA-OAEP SHA-256 wraps the key. The host holds the public key only. Keep the private key separately from the production host and its backup storage.

The current offline private key is Windows-DPAPI protected in `M:/loomic-builds/launch-20261123/backup-private-key.dpapi`. Keep this file and its Windows user profile recoverable. It is a permanent backup-recovery key, not a temporary deployment credential. It must not be deleted during ordinary credential cleanup.

Each completed local backup writes a SHA-256 receipt. Retain seven encrypted local copies and the newest mode-0600 dump for weekly rehearsal. Old raw dumps are removed after a new verified encrypted copy exists. With `offsiteEnabled=true`, only ciphertext is uploaded to the configured S3 bucket. The current B2 plan retains three remote copies under the dedicated prefix. Upload failures remain visible in monitoring and do not prevent the next daily local backup. A deferred offsite target is recorded explicitly; it is not disaster-recovery completion.

Backblaze uses a private bucket, explicit `storageEndpoint`/`storageRegion`/`storageBucket`, and a separate mode-0600 `storageCredentialsFile` containing `BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY`. It never falls back to public-media credentials when a custom S3 endpoint is configured. Scope the application key to this bucket and the `helstera-backups/v1/` prefix, with read/write/list/delete capabilities. No master key is required.

B2 retains object versions after name-only deletes. Set `storageVersioned=true` to delete the full versions and delete markers of expired backup names. Uploads use checksum metadata and reuse an identical existing object after an interrupted receipt write. Downloads verify the entire SHA-256 before exposing the completed file and never overwrite a previous recovery file.

With `storageMaxBytes=10000000000`, each upload counts stored versions and unfinished multipart parts first. A new snapshot is uploaded before old backups are removed, so three retained archives temporarily need room for four. If that would exceed the limit, uploading stops and monitoring reports a stale offsite copy. The allowance is account-wide: keep unrelated buckets empty or lower this bucket limit to reserve their space. Use the B2 console's account spending caps as the final account-wide limit.

After changing offsite storage or restoring credentials, `ops_offsite.py --config /www/helstera/ops/config.json` publishes the newest verified archive without generating another database dump. Confirm its receipt, download it and check the digest before declaring the offsite restore path complete.

`ops_restore.py` verifies the newest dump digest, restores it into a private Unix-socket-only PostgreSQL cluster, checks required tables and runs current migrations there. It verifies the cluster identity before restoring, stops the cluster and removes its files afterward. It never restores over production. The rehearsal directory needs execute permission for the postgres OS account; files and cluster sockets remain restricted.

For offline ciphertext recovery, use `ops_crypto.decrypt_backup(source, target, private_pem)`. Verify the ciphertext digest from the receipt before decryption and the `database.dump` digest afterward. A failed authentication tag removes partial plaintext. Extract configuration only into a protected directory; inspect Nginx paths and the target database before any actual disaster restore.

## Schedules and health checks

Production systemd services/timers:

- `helstera-backup`: daily at 03:10 Asia/Shanghai, plus up to ten minutes randomized delay.
- `helstera-restore`: Sunday at 04:20 Asia/Shanghai, plus up to ten minutes randomized delay.
- `helstera-monitor`: every five minutes, beginning two minutes after boot.

Monitoring checks public HTTPS readiness, PostgreSQL queries, an online Worker, queued tasks older than ten minutes, running tasks older than two hours, free disk under 8 GiB or 10%, local/offsite backup age over 26 hours, and recovery rehearsal age over eight days. State is in `health.json`, `last-notice.json` and the backup receipts. Failures send an alert; changes and recovery send a new notice, and unchanged failures repeat at most hourly. Failed mail delivery does not advance the sent state, so it is retried. SMTP acceptance and recipient inbox confirmation are separate evidence.

`ops_external_monitor.py` also runs from the existing independent SSH jump host, under `/home/add/.helstera-monitor`, every five minutes via the add user's crontab. It checks public HTTPS readiness and sends sustained outage/recovery notices using the separate mail host. Two consecutive failures trigger the first notice; unchanged failures repeat hourly. The config is mode 0600, the containing directory mode 0700, and it contains only mail credentials and the health URL. A production-host outage does not stop this probe. Its current health check and SMTP authentication have been verified; the production host was not deliberately stopped.

## Updating and rolling back

When changing API releases, update `server` in the operations config to the tested release. Keep `/www/helstera/ops` outside application release retention. Preview units with `python3 install-ops-units.py --config /www/helstera/ops/config.json`, then pass `--apply` to install. Start an actual backup and isolated recovery before considering setup verified. Disable only the relevant timer to roll back a maintenance change; keep existing backups and recovery keys. Remove only the crontab line tagged `helstera-external-monitor` when retiring the external probe.

Tests: `python -m unittest scripts.test_ops_readiness -v`, `node --test scripts/ops-storage.test.mjs` and `node --check scripts/ops-runtime.mjs`. The crypto test verifies actual decryption and rejects a modified ciphertext without leaving plaintext; monitor tests cover independent failures, missing signals, deduplication, recovery and repeated alerts. Storage tests cover independent credentials, complete version pruning, pagination and capacity limits including unfinished uploads.
