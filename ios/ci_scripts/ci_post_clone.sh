#!/bin/bash
set -euo pipefail

WORKDIR="${CI_PRIMARY_REPOSITORY_PATH:-${CI_WORKSPACE:-$(pwd)}}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

echo "==> ci_post_clone: start"
echo "==> working dir: ${WORKDIR}"
echo "==> PATH: ${PATH}"

cd "${WORKDIR}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "==> Node/npm not found on PATH, trying Homebrew node@20"
  if command -v brew >/dev/null 2>&1; then
    brew install node@20
    export PATH="$(brew --prefix node@20)/bin:${PATH}"
  fi
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "==> ERROR: node/npm still not found. Aborting."
  exit 1
fi

echo "==> Node: $(node -v || true)"
echo "==> NPM: $(npm -v || true)"

echo "==> Installing JS dependencies"
npm ci --include=dev

echo "==> Installing CocoaPods dependencies"
cd ios
pod install --repo-update

echo "==> ci_post_clone: done"
