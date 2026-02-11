#!/bin/bash
set -euo pipefail

echo "==> ci_post_clone: start"
echo "==> working dir: $CI_WORKSPACE"

cd "$CI_WORKSPACE"

echo "==> Node: $(node -v || true)"
echo "==> NPM: $(npm -v || true)"

echo "==> Installing JS dependencies"
npm ci --include=dev

echo "==> Installing CocoaPods dependencies"
cd ios
pod install --repo-update

echo "==> ci_post_clone: done"

