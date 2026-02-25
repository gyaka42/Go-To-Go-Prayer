#!/bin/bash
set -euo pipefail

WORKDIR="${CI_PRIMARY_REPOSITORY_PATH:-${CI_WORKSPACE:-$(pwd)}}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
if [ -d "/opt/pmk/env/global/bin" ]; then
  export PATH="/opt/pmk/env/global/bin:${PATH}"
fi
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

run_with_heartbeat() {
  local label="$1"
  shift
  echo "==> ${label}: start"
  "$@" &
  local cmd_pid=$!
  while kill -0 "${cmd_pid}" 2>/dev/null; do
    sleep 60
    if kill -0 "${cmd_pid}" 2>/dev/null; then
      echo "==> ${label}: still running..."
    fi
  done
  wait "${cmd_pid}"
  local status=$?
  echo "==> ${label}: done (exit ${status})"
  return "${status}"
}

ensure_node_in_path() {
  local candidate
  for candidate in \
    "/opt/homebrew/bin" \
    "/usr/local/bin" \
    "/opt/homebrew/opt/node/bin" \
    "/opt/homebrew/opt/node@20/bin" \
    "/opt/homebrew/opt/node@22/bin"
  do
    if [ -x "${candidate}/node" ] && [ -x "${candidate}/npm" ]; then
      export PATH="${candidate}:${PATH}"
      return 0
    fi
  done

  if command -v brew >/dev/null 2>&1; then
    for formula in node node@20 node@22; do
      if brew list --versions "${formula}" >/dev/null 2>&1; then
        local prefix
        prefix="$(brew --prefix "${formula}")"
        if [ -x "${prefix}/bin/node" ] && [ -x "${prefix}/bin/npm" ]; then
          export PATH="${prefix}/bin:${PATH}"
          return 0
        fi
      fi
    done
  fi

  return 1
}

echo "==> ci_post_clone: start"
echo "==> working dir: ${WORKDIR}"
echo "==> PATH: ${PATH}"

cd "${WORKDIR}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "==> node/npm not found in current PATH, probing known locations"
  if ! ensure_node_in_path; then
    echo "==> ERROR: node/npm not available on runner; aborting without Homebrew install to avoid CI timeout."
    exit 1
  fi
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "==> ERROR: node/npm still not found after fallback."
  exit 1
fi

echo "==> Node: $(node -v || true)"
echo "==> NPM: $(npm -v || true)"

echo "==> Installing JS dependencies"
if ! run_with_heartbeat "npm ci" npm ci --include=dev; then
  echo "==> npm ci failed, retrying with npm install"
  run_with_heartbeat "npm install" npm install --include=dev
fi

echo "==> Installing CocoaPods dependencies"
cd ios

# React Native from source requires cmake (hermes-engine podspec checks it).
if grep -q '"ios.buildReactNativeFromSource": "true"' Podfile.properties.json 2>/dev/null; then
  if ! command -v cmake >/dev/null 2>&1; then
    echo "==> cmake not found; installing via Homebrew"
    brew install cmake
  fi
  if ! command -v ninja >/dev/null 2>&1; then
    echo "==> ninja not found; installing via Homebrew"
    brew install ninja
  fi
  echo "==> CMake: $(cmake --version | head -n 1 || true)"
fi

echo "==> Scanning pbxproj objectVersion values"
find . -name "*.pbxproj" -print0 | while IFS= read -r -d '' f; do
  if grep -q "objectVersion = 70;" "$f"; then
    echo "==> Patching $f : objectVersion 70 -> 56"
    sed -i '' 's/objectVersion = 70;/objectVersion = 56;/g' "$f"
  fi
done
echo "==> objectVersion values after patch:"
grep -R "objectVersion =" . --include="*.pbxproj" || true
if ! run_with_heartbeat "pod install" pod install; then
  echo "==> pod install failed, retrying with --repo-update"
  run_with_heartbeat "pod install --repo-update" pod install --repo-update
fi

echo "==> ci_post_clone: done"
