#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
docker compose --profile tools run --rm certificates
docker compose restart telemetry command-proxy
