#!/bin/bash
set -euo pipefail

WORKDIR="${CI_PRIMARY_REPOSITORY_PATH:-${CI_WORKSPACE:-$(pwd)}}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
if [ -d "/opt/pmk/env/global/bin" ]; then
  export PATH="/opt/pmk/env/global/bin:${PATH}"
fi

echo "==> ci_post_clone: start"
echo "==> working dir: ${WORKDIR}"
echo "==> PATH: ${PATH}"

cd "${WORKDIR}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "==> ERROR: node/npm not found on PATH. Aborting."
  exit 1
fi

echo "==> Node: $(node -v || true)"
echo "==> NPM: $(npm -v || true)"

echo "==> Installing JS dependencies"
npm ci --include=dev

echo "==> Installing CocoaPods dependencies"
cd ios
pod install

echo "==> ci_post_clone: done"
