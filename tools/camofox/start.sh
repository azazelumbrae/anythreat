#!/usr/bin/env bash
# Arranca el servidor camofox con TODOS sus datos dentro de ~/anythreat/tools/camofox/data.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
export CAMOFOX_PROFILE_DIR="$HERE/data/profiles"
export CAMOFOX_COOKIES_DIR="$HERE/data/cookies"
export CAMOFOX_TRACES_DIR="$HERE/data/traces"
export CAMOFOX_UPLOADS_DIR="$HERE/data/uploads"
export CAMOFOX_PORT="${CAMOFOX_PORT:-9377}"
mkdir -p "$CAMOFOX_PROFILE_DIR" "$CAMOFOX_COOKIES_DIR" "$CAMOFOX_TRACES_DIR" "$CAMOFOX_UPLOADS_DIR"
cd "$HERE" && exec npx camofox-browser
