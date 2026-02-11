#!/bin/bash
set -euo pipefail

echo "==> ci_pre_xcodebuild: start"
echo "==> working dir: ${CI_WORKSPACE:-$(pwd)}"

if [ -n "${CI_WORKSPACE:-}" ]; then
  cd "$CI_WORKSPACE"
fi

if [ ! -f "ios/Pods/Target Support Files/Pods-GoToGoPrayer/Pods-GoToGoPrayer.release.xcconfig" ]; then
  echo "==> Pods xcconfig missing, running pod install"
  cd ios
  pod install --repo-update
  cd ..
else
  echo "==> Pods xcconfig found, skipping pod install"
fi

echo "==> ci_pre_xcodebuild: done"
