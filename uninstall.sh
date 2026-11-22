#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/deploy/server"

mode=${1:-cloud}
case "$mode" in
    cloud) docker compose -f compose.yaml -f compose.cloud.yaml -f compose.source.yaml down --remove-orphans || true ;;
    local) docker compose -f compose.yaml -f compose.source.yaml down --remove-orphans || true ;;
    *) echo 'Usage: bash uninstall.sh [cloud|local]' >&2; exit 2 ;;
esac
echo 'Containers removed. The .env file and Docker volumes were kept.'
echo 'Delete them manually only after checking that you no longer need the pairing code or Caddy certificates.'
