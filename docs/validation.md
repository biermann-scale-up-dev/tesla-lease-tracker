# Validation and release acceptance

## Local evidence — 2026-09-17

Version: **0.3.0 prerelease**. All input records, screenshots and credentials used for these checks were synthetic. No Tesla account, physical vehicle or iPhone was accessed.

| Check | Result |
| --- | --- |
| ESLint, strict TypeScript, Vite client and TypeScript server production builds | Passed |
| SQLite/domain/API/receiver/process/Scriptable integration tests (`npm test`) | 20 passed |
| Real Redpanda → Kafka consumer → SQLite, consumer restart and duplicate replay | 1 passed |
| Browser journeys: desktop Chromium, mobile Chromium, mobile WebKit | 21 passed (7 per project) |
| Light/dark UI, all four sections at 320/390/430/1440 CSS pixels | Passed; no document-level horizontal overflow |
| Synthetic dashboard, mobile forecast cards and Tesla quick-view screenshots | Visually inspected |
| App container build (Node 24.19.0), migrations, production owner/reader cookies, device isolation and built assets | Passed |

Local JavaScript checks used Node 24.21.0 on macOS with Playwright-managed Chromium and WebKit. The source was validated from an isolated temporary directory because the host workspace intermittently stalled filesystem operations; build inputs were copied from this repository. CI repeats the checks on Linux and builds the application container.

Browser journeys cover direct links/back navigation, editable settings, all forecast bases, offline reload, the last-20-trips snapshot, session expiry, offline logout/reconnect, missing readings, full offline storage, Tesla QR approval, persisted reader cookies, per-device forecast changes, revocation and explicit service-worker updates with dirty-form protection. Chromium uses browser offline emulation. WebKit uses dropped test-server connections because emulated offline reload failed in the automation layer; its real service worker, Cache API and IndexedDB remain active. The isolated missing-data/storage-error scenario blocks service workers to reliably intercept its synthetic API response. These checks do not establish iPhone installation or actual vehicle-browser compatibility.

SQLite/API checks cover pairing expiry, single use, hashed credentials, restart persistence, owner/device access boundaries, CSRF, retry limits, device selection and revocation. The distributed Scriptable JavaScript runs in thin host adapters against the real Fastify/SQLite API, covering all three widget families, a cached outage and confirmed revocation. Native Scriptable rendering and iOS scheduling require the physical checks below.

Existing domain tests retain P/D/R/N manoeuvres, parking stops, duplicates and late packets, incomplete trip boundaries, invalid/decreasing odometers, recovery gaps, parked days, consumer/database restart, mid-contract onboarding, contract dates, overspend, leap years, daylight-saving boundaries, midnight arrivals and independent forecast windows. The broker test does **not** emulate a Tesla client certificate or the vehicle wire protocol.

### Earlier infrastructure evidence — 2026-09-13

The v0.1.0 baseline passed the official receiver build at `8fbaa100bd365936dab6ecbf0e2d7070c4d765cb`, temporary Compose app/receiver/Redpanda/command-proxy/backup startup, production session boundaries, receiver mTLS rejection, backup integrity and certificate renewal with stable CA/command keys. These infrastructure checks are historical evidence, not a new physical-car or public-VPS acceptance. Public DNS, ACME issuance and systemd scheduling remain deployment checks.

## Development restart regression

The development-restart failure was observed as a running `tsx watch` parent with no remaining server child under unsupported Node 20.19.1. The replacement uses native Node 24 watch. Two process integration checks passed for file-change restart, recovery after a signalled child exit, Ctrl+C termination without listener warnings, and bounded shutdown during failed broker connection attempts. The unsupported-runtime guard was also checked using Node 20. No global runtime settings were changed.

## Real-vehicle acceptance — pending

The prerelease is available for evaluation. Do not interpret local or CI results as physical-vehicle acceptance.

1. Record the vehicle's firmware and Fleet Telemetry version, confirming at least 1.3.0. Keep the VIN private.
2. Register the installation's own Tesla app, verify its payment method and zero additional-spend limit, complete OAuth and pair the virtual key.
3. Confirm the signed Gear/Odometer configuration is synchronized and the receiver is reachable from the vehicle.
4. Drive two real trips. Include D/R manoeuvring and a distinct parking stop. Compare start/end readings and total distance with the vehicle display, allowing only display rounding. Check that no location fields are collected.
5. Restart the receiver during an additional drive or controlled connectivity interruption. Confirm the trip stays open until P, buffered records arrive and replay does not duplicate mileage.
6. Check the next local-day boundary, overnight parking, remaining budget and all four forecasts. Short windows should remain unavailable until their observation periods are complete.
7. Restore a backup into an isolated installation, verify token-key recovery and retained Kafka replay, and check VPS certificate-renewal scheduling.

Record dates, firmware, odometer differences and outcomes in a private acceptance log. Publish only redacted results. Any missing boundary, unexplained distance or delivery loss must remain visible as a data-quality issue.

## Physical mobile/device acceptance — pending

1. On an iPhone, install from Safari, log in, close/reopen offline, inspect both appearances and safe areas, verify the saved timestamps, then perform offline logout and reconnect.
2. Import the distributed script into Scriptable. Pair and inspect small/medium Home Screen and rectangular Lock Screen widgets with populated, missing and incomplete data. Check system appearance, tap destination, cached outage and revocation. Observe iOS refresh scheduling; a requested 30-minute refresh is not a timing guarantee.
3. In a parked Tesla, open `/tesla`, scan and approve the matching code from an authenticated phone, and inspect all metrics. Close/restart the vehicle browser and verify reader persistence, visible-page refresh, per-device forecast selection and revocation.
4. Exercise an app update on the installed iPhone with an unsaved form; confirm explicit consent and preserved access after activation.

Record device/OS/vehicle firmware, date and outcome without publishing credentials or real mileage. Automated Chromium/WebKit checks do not replace this acceptance.

## Release verification

The public [CI workflow](https://github.com/biermann-scale-up-dev/tesla-lease-tracker/actions/workflows/ci.yml) is the remote verification record, including the application container build. The [v0.3.0 prerelease](https://github.com/biermann-scale-up-dev/tesla-lease-tracker/releases/tag/v0.3.0) explicitly retains pending physical iPhone, Scriptable, Tesla-browser and real-vehicle acceptance. Source and commit history are checked with `npm run scan` before publication; runtime directories are excluded by `.gitignore` and `.dockerignore`.
