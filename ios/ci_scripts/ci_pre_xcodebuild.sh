#!/bin/bash
set -euo pipefail

WORKDIR="${CI_PRIMARY_REPOSITORY_PATH:-${CI_WORKSPACE:-$(pwd)}}"

echo "==> ci_pre_xcodebuild: start"
echo "==> working dir: ${WORKDIR}"

cd "${WORKDIR}"

if [ ! -f "ios/Pods/Target Support Files/Pods-GoToGoPrayer/Pods-GoToGoPrayer.release.xcconfig" ]; then
  echo "==> Pods xcconfig missing, running pod install"
  cd ios
  pod install --repo-update
  cd ..
else
  echo "==> Pods xcconfig found, skipping pod install"
fi

echo "==> ci_pre_xcodebuild: done"
