# Deployment, maintenance and recovery

## VPS deployment

Use Linux with Docker Engine/Compose and enough memory for Node, Redpanda and the receiver (start with 4 GB RAM; building the upstream telemetry image may require more). The Compose deployment is one host, one broker and one replica. It does not provide high availability. DNS must point the app and telemetry names at the VPS. Expose TCP 80/443 for the app and TCP 8443 for telemetry; do not publish the broker, command proxy or database.

1. Clone the repository, install Node 24/npm, run `npm ci` and `npm run setup` in the project directory. Save the printed app password privately.
2. Edit `.env`. Preserve its generated `APP_PASSWORD_HASH` and `ENCRYPTION_KEY`; set production `APP_ORIGIN` and append `APP_DOMAIN`, `TELEMETRY_HOST`, `TELEMETRY_PORT=8443`, `ACME_EMAIL`, Tesla credentials and region from `.env.example`. The Compose app service overrides local paths and binds internally to `0.0.0.0`.
3. Generate the installation's private CA, TLS certificates and command key:

   ```sh
   docker compose --profile tools run --build --rm certificates
   ```

4. Build and start:

   ```sh
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=100 app telemetry
   ```

5. Open the app over its configured HTTPS origin and follow [Tesla onboarding](tesla-setup.md).

Caddy obtains and renews the browser-facing public certificate through ACME. Fleet Telemetry terminates its own mTLS directly on port 8443; do not terminate that connection in an ordinary HTTP reverse proxy/CDN. The dedicated telemetry CA is trusted by the vehicle through the signed configuration; the receiver independently validates Tesla client certificates using the official implementation. Backend-to-command-proxy TLS trusts the same installation CA through `NODE_EXTRA_CA_CERTS`.

All credentials, private keys, SQLite files, Kafka contents and backups are runtime-only. Directory mounts `certs/` and `secrets/` are created with restricted permissions for UID/GID 1000. The public command key and CA are intentionally readable. The app runs as a non-root Node user.

## Certificate renewal

Telemetry/proxy leaf certificates last 90 days. The dedicated root lasts 10 years and stays constant during leaf renewal; the command authentication key also stays constant. Renew monthly and restart the two certificate consumers:

```sh
sh ops/renew-certificates.sh
```

For automatic renewal, install `ops/lease-tracker-renew.service` and `.timer` in `/etc/systemd/system/`, adjust **both** paths in the service to your checkout, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now lease-tracker-renew.timer
systemctl list-timers lease-tracker-renew.timer
```

Check renewal failures with `journalctl -u lease-tracker-renew.service`. A private-CA replacement is a separate operation: reconfigure each vehicle with the new CA and re-establish trust before removing the old CA. Back up the original root key securely.

## Backups

The backup container makes a consistent SQLite Online Backup API snapshot on startup and every 24 hours, keeping the newest 30 snapshots in the `app-backups` volume. It logs completion and exits on errors so Docker restarts it and exposes failures. Back up `.env` (especially `ENCRYPTION_KEY`) and private keys separately using your existing encrypted backup system. A database backup without its original encryption key cannot restore Tesla tokens.

Copy backups off the VPS regularly. Example, writing a backup directory in this checkout (ignored by Git):

```sh
mkdir -p backups
docker compose cp backup:/backups/. ./backups/
```

For a local installation:

```sh
npm run backup -- backups/tracker-2026-09-12.sqlite
```

Do not copy the active SQLite file alone while WAL writes are ongoing. Use the backup service/API or stop all database users first.

## Restore

1. Keep the original `.env` encryption key and command/CA keys. Choose a known-good backup and verify it with SQLite `PRAGMA integrity_check`.
2. Stop `app` and `backup`. Preserve the current database volume for rollback before replacing anything.
3. Copy the chosen snapshot into the database volume as `tracker.sqlite` with UID/GID 1000. Move the previous database and its `-wal`/`-shm` siblings together into your rollback copy; do not mix old WAL files with a restored snapshot.
4. Start `app` and `backup`; verify contract, trip history, authorization and ingestion. Kafka may replay records; deduplication prevents double counting. If the retained Kafka offsets are ahead of the restored database, stop ingestion, reset only this application's consumer group to replay retained records, then restart it. Do not reset other consumers.
5. Re-authorize Tesla if its refresh token has rotated beyond the restored backup. Review gaps beyond the broker's 30-day retention; never claim those days are complete without evidence.

## Monitoring and updates

`/healthz` is unauthenticated process liveness. The authenticated dashboard probes the receiver's internal `http://telemetry:8080/status` endpoint (`TELEMETRY_STATUS_URL`, two-second timeout) and additionally reports broker connection, last message time, vehicle connectivity, rejected records and Tesla setup status. Receiver failure is separate from a disconnected vehicle. A vehicle disconnect alone cannot distinguish sleep from a mobile-network interruption; the UI states both possibilities. The internal probe does not call Tesla or wake the car. Inspect backup logs and systemd renewal status as part of VPS monitoring. The application checks tokens hourly and fleet configuration daily; provider downtime is reported, not silently replaced with fake data.

Before upgrades, create a backup, inspect the changelog, pull the intended tag and rebuild. SQLite migrations are recorded and applied transactionally at startup. Never delete migration records to pretend a schema rollback occurred; restore the backed-up database and previous image together if needed.

Tests use the separate `lease-tracker-tests` Compose project. Clean up only that project with `docker compose -f compose.test.yaml down --volumes --rmi all`; do not run global Docker prune commands on a shared VPS.
