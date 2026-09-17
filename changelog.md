# Changelog

## 0.3.0 — 2026-09-17

### Features

- `src/web/{App,Settings,Experience,Devices,TeslaView}.tsx`, `src/web/{styles,mobile}.css`: four mobile navigation areas, light/dark/system themes, expandable trip cards, compact forecast comparisons, accessible touch/focus controls, installation help and a parked Tesla quick view.
- `src/web/{offline,useOwner}.ts`, `public/sw.js`, `vite.config.ts`, `public/manifest.webmanifest`, `public/{apple-touch-icon,icon-maskable-512}.png`, `index.html`: versioned public shell cache, session-bounded IndexedDB snapshots with the latest 20 trips, offline logout/reconnect and explicitly accepted updates protected by unsaved forms.
- `src/server/{devices,store,app}.ts`, `src/shared/{types,widget,analytics}.ts`: additive device/pairing migration, hashed reader credentials, ten-minute one-time codes, smartphone Tesla approval, revocation, per-device forecasts and a shared read-only widget summary without additional Fleet API requests.
- `public/lease-tracker.scriptable.js`: Scriptable small/medium Home Screen and rectangular Lock Screen widgets, Keychain pairing, cached outage display, revocation clearing and a minimum requested 30-minute refresh.

### Fixes

- `src/web/{api,useOwner,offline}.ts`: confirmed authentication failure clears personal offline data; pending offline logout survives reload; late requests cannot repopulate a logged-out snapshot; storage failures retain the live dashboard with an actionable message.
- `src/shared/analytics.ts`, `src/web/App.tsx`: preserve full aggregate trip counts when the offline trip list is truncated and keep missing readings explicit.

### Docs

- `README.md`, `docs/{architecture,mobile-and-widgets,validation}.md`, `docs/images/`, `THIRD_PARTY_NOTICES.md`: English setup, API/security boundaries, PWA/widget operation, synthetic screenshots, test evidence and separate pending physical-device/vehicle acceptance.

### Chores

- `tests/{devices,scriptable}.test.ts`, `tests/browser/app.spec.ts`, `tests/e2e-server.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`: pairing and Scriptable integration coverage plus Chromium/WebKit offline, expiry, update and device journeys. Local validation passed 20 integration/domain/process checks, one real-broker test and 21 browser checks. The production container build and synthetic migration/cookie/access-boundary smoke also passed.
- `package.json`, `package-lock.json`, `eslint.config.js`, `src/web/main.tsx`: version 0.3.0, QR-code dependency and tooling for the new app surfaces. MIT licensing remains unchanged; no native iOS app, push notifications or cost-per-kilometre feature.

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
