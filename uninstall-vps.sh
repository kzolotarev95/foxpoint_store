#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/foxpoint_store}"
PURGE="${PURGE:-0}"

log() {
  printf '%s\n' "$*"
}

if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
  if command -v docker >/dev/null 2>&1; then
    docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
fi

if [ "$PURGE" = "1" ]; then
  rm -rf "$APP_DIR"
  log "Removed $APP_DIR"
else
  log "Stopped FoxPoint containers."
  log "Set PURGE=1 to remove project files too."
fi

