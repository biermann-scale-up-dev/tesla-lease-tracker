# Validation and release acceptance

## Local evidence — 2026-09-13

Version: **0.1.0 prerelease**. All input records, screenshots, credentials and certificates used for these checks were synthetic. No Tesla account or physical vehicle was accessed.

| Check | Result |
| --- | --- |
| ESLint, strict TypeScript, Vite client and TypeScript server production builds | Passed |
| SQLite/domain/API/receiver/process integration tests (`npm test`) | 17 passed |
| Real Redpanda → Kafka consumer → SQLite, consumer restart and duplicate replay | 1 passed |
| Browser journeys in desktop and mobile Chromium | 4 passed |
| Desktop and mobile synthetic screenshots | Visually inspected; no document-level horizontal overflow |
| App container build, Node 24.19.0 | Passed |
| Official Fleet Telemetry receiver build at `8fbaa100bd365936dab6ecbf0e2d7070c4d765cb` | Passed |
| Compose app, receiver, Redpanda, command proxy and backup startup | Passed with temporary configuration |
| Production session cookie, unauthenticated API rejection, public command key, receiver and broker status | Passed inside the app container |
| Receiver mTLS rejects a client without a client certificate | Passed |
| SQLite backup service and backup `PRAGMA integrity_check` | Passed |
| Leaf certificate renewal preserves CA and command public key; receiver/proxy restart | Passed |

Local JavaScript checks used Node 24.21.0 and the installed Google Chrome executable on macOS. CI installs Node 24 and Playwright Chromium on Linux and independently builds the application container. The source was also validated from an isolated temporary directory because the host workspace intermittently stalled filesystem operations. Build inputs were copied from this repository.

Test cases cover P/D/R/N manoeuvres, parking stops, duplicate and late packets, incomplete trip boundaries, invalid and decreasing odometers, recovery gaps, parked days, consumer/database restart, mid-contract onboarding, before/after-contract dates, negative remaining mileage, leap years, daylight-saving calendar boundaries, midnight arrivals and independent forecast windows. Authentication checks cover origin validation, session logout, private APIs, encryption and session-bound, single-use OAuth state.

The real broker test does **not** emulate a Tesla client certificate or the vehicle's wire protocol. The container smoke checks validate service startup, certificate handling and rejection of unauthenticated clients; they do not prove delivery from a physical car. Public DNS, ACME issuance and systemd scheduling require validation on the deployment VPS.

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

## Release verification

The public [CI workflow](https://github.com/biermann-scale-up-dev/tesla-lease-tracker/actions/workflows/ci.yml) is the current remote verification record. The [v0.1.0 prerelease](https://github.com/biermann-scale-up-dev/tesla-lease-tracker/releases/tag/v0.1.0) explicitly retains the pending physical-vehicle acceptance. Source and commit history are checked with `npm run scan` before publication; runtime directories are excluded by `.gitignore` and `.dockerignore`.
