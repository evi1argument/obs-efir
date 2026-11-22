#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

mode=${1:-}
if [[ -n $mode && $mode != cloud && $mode != local ]]; then
    echo 'Usage: sudo bash install.sh [cloud|local]' >&2
    exit 2
fi

exec bash deploy/server/install.sh "${mode:-}"
