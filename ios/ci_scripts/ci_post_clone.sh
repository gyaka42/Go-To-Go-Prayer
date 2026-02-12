#!/bin/bash
set -euo pipefail

WORKDIR="${CI_PRIMARY_REPOSITORY_PATH:-${CI_WORKSPACE:-$(pwd)}}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
if [ -d "/opt/pmk/env/global/bin" ]; then
  export PATH="/opt/pmk/env/global/bin:${PATH}"
fi
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

echo "==> ci_post_clone: start"
echo "==> working dir: ${WORKDIR}"
echo "==> PATH: ${PATH}"

cd "${WORKDIR}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "==> node/npm not found, trying Homebrew fallback install"
  if ! command -v brew >/dev/null 2>&1; then
    echo "==> ERROR: brew not found; cannot install node."
    exit 1
  fi

  if brew list --versions node >/dev/null 2>&1; then
    export PATH="$(brew --prefix node)/bin:${PATH}"
  elif brew list --versions node@20 >/dev/null 2>&1; then
    export PATH="$(brew --prefix node@20)/bin:${PATH}"
  else
    brew install node || brew install node@20
    if brew list --versions node >/dev/null 2>&1; then
      export PATH="$(brew --prefix node)/bin:${PATH}"
    elif brew list --versions node@20 >/dev/null 2>&1; then
      export PATH="$(brew --prefix node@20)/bin:${PATH}"
    fi
  fi
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "==> ERROR: node/npm still not found after fallback."
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
