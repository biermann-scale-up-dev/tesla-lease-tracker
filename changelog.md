# Changelog

## 0.1.0 — 2026-09-13

### Features

- `src/shared/{types,dates,analytics}.ts`: typed lease model, calendar-day budgets, chronological trip reconstruction, explicit data gaps, unassigned mileage and independent configurable forecasts.
- `src/server/`: Fastify JSON API, private owner session, encrypted Tesla OAuth tokens, session-bound consent state, official Fleet API setup, durable Kafka ingestion and migrated SQLite storage.
- `src/web/`, `index.html`, `public/`: German responsive dashboard, trip history, contract setup, forecast chart/table and installable PWA with private offline behavior.
- `Dockerfile`, `compose.yaml`, `ops/`, `src/server/backup-job.ts`: self-hosted deployment using the official Tesla receiver and command proxy, Redpanda, mTLS, separate receiver health, certificate renewal and daily SQLite backups.

### Fixes

- `package.json`, `.npmrc`, `scripts/check-node.mjs`, `src/server/{index,tesla}.ts`, `tests/lifecycle.test.ts`: replace the hanging `tsx watch` supervisor with native Node 24 watch, reject unsupported runtimes, cancel provider work during shutdown, enforce a cleanup deadline, and cover restart/signalled-child/Ctrl+C/broker-startup termination with process tests.
- `src/shared/analytics.ts`, `src/server/telemetry.ts`: preserve the last valid odometer, leave entire invalid-reading recovery intervals incomplete, keep unassigned distance visible, and prevent late connectivity events from overriding newer status.
- `ops/telemetry.json`, `compose.yaml`: use reliable acknowledgments only for vehicle records, configure a dedicated receiver status endpoint and a backup-specific health check.

### Docs

- `README.md`, `docs/`, `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md`: English onboarding, architecture, calculations, API, operating/recovery instructions, synthetic screenshots and explicit pending physical-vehicle acceptance.
- `LICENSE`, `package.json`, `package-lock.json`: initial version 0.1.0 with the unchanged MIT license and copyright 2026 biermann-scale-up-dev. Third-party licenses remain separate.

### Chores

- `tests/`, `playwright.config.ts`, `compose.test.yaml`, `.github/workflows/ci.yml`: 17 passing local domain/API/SQLite/receiver/process checks, one real-broker restart/replay check, four desktop/mobile browser journeys and automated lint/type/build validation.
- `scripts/`, `.env.example`, `.gitignore`, `.dockerignore`, project tool configuration: safe installation/demo/backup helpers, placeholder-only configuration and source/history secret scanning.
- Docker smoke validation passed for app/receiver/proxy/broker/backup startup, secure session boundaries, mTLS rejection, backup integrity and certificate renewal. Physical Tesla and public VPS acceptance remain pending for this prerelease.
