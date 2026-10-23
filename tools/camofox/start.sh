#!/usr/bin/env bash
# Arranca el servidor camofox con TODOS sus datos dentro de ~/anythreat/tools/camofox/data.
# Modo Tor: si AT_CAMOFOX_TOR=1 o $ALL_PROXY apunta a :9050, el navegador sale por Tor (SOCKS5),
# mientras el API REST sigue en 127.0.0.1 (directo).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
export CAMOFOX_PROFILE_DIR="$HERE/data/profiles"
export CAMOFOX_COOKIES_DIR="$HERE/data/cookies"
export CAMOFOX_TRACES_DIR="$HERE/data/traces"
export CAMOFOX_UPLOADS_DIR="$HERE/data/uploads"
export CAMOFOX_PORT="${CAMOFOX_PORT:-9377}"

MODE="direct"
if [ -n "${AT_CAMOFOX_TOR:-}" ] || printf '%s' "${ALL_PROXY:-}" | grep -q "9050"; then MODE="tor"; fi
if [ "$MODE" = "tor" ]; then
  export PROXY_HOST="${PROXY_HOST:-127.0.0.1}"
  export PROXY_PORT="${PROXY_PORT:-9050}"
  export PROXY_PROTOCOL="${PROXY_PROTOCOL:-socks5}"
fi
printf '%s' "$MODE" > "$HERE/.mode" 2>/dev/null || true

mkdir -p "$CAMOFOX_PROFILE_DIR" "$CAMOFOX_COOKIES_DIR" "$CAMOFOX_TRACES_DIR" "$CAMOFOX_UPLOADS_DIR"
cd "$HERE" && exec npx camofox-browser
