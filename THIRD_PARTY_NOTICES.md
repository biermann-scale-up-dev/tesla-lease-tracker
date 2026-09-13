# Third-party software

The root MIT license applies to original Tesla Lease Tracker code. It does not relicense dependencies or separately distributed services.

- Tesla [Fleet Telemetry](https://github.com/teslamotors/fleet-telemetry) and [Vehicle Command SDK](https://github.com/teslamotors/vehicle-command) retain their Apache-2.0 licenses and notices. They run as separate services; this repository does not vendor their source.
- [Redpanda](https://github.com/redpanda-data/redpanda) is a separately distributed broker with its own license terms. Review the selected release's terms for your use; the project's MIT license does not apply to Redpanda.
- Node.js, React, Vite, Fastify, TypeScript, Recharts, KafkaJS, Zod, the Temporal polyfill, Lucide and other npm dependencies retain the license files shipped in their packages. `package-lock.json` records the exact dependency versions.
- Caddy, Alpine, Debian, OpenSSL and upstream container images retain their own licenses and notices.

Do not remove notices from redistributed dependencies or imply that this repository grants rights to Tesla trademarks. The app icon is original project artwork and does not use Tesla's logo.
