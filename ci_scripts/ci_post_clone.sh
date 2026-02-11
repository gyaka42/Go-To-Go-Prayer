#!/bin/bash
set -euo pipefail

WORKDIR="${CI_PRIMARY_REPOSITORY_PATH:-${CI_WORKSPACE:-$(pwd)}}"

echo "==> ci_post_clone: start"
echo "==> working dir: ${WORKDIR}"

cd "${WORKDIR}"

echo "==> Node: $(node -v || true)"
echo "==> NPM: $(npm -v || true)"

echo "==> Installing JS dependencies"
npm ci --include=dev

echo "==> Installing CocoaPods dependencies"
cd ios
pod install --repo-update

echo "==> ci_post_clone: done"
