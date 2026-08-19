#!/bin/sh
set -eu

REPO_URL="${REPO_URL:-https://github.com/kzolotarev95/foxpoint_store.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/foxpoint_store}"

log() {
  printf '%s\n' "$*"
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    log "Run this script with sudo."
    exit 1
  fi
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  if ! command -v apt-get >/dev/null 2>&1; then
    log "apt-get is required."
    exit 1
  fi

  apt-get update
  apt-get install -y ca-certificates curl git gnupg

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  . /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
}

sync_repo() {
  mkdir -p "$(dirname "$APP_DIR")"

  if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR"
    git remote set-url origin "$REPO_URL" >/dev/null 2>&1 || true
    git fetch origin "$BRANCH"
    git reset --hard "origin/$BRANCH"
    return
  fi

  if [ -d "$APP_DIR" ] && [ "$(ls -A "$APP_DIR" 2>/dev/null | wc -l)" -gt 0 ]; then
    log "$APP_DIR exists and is not empty."
    log "Set APP_DIR to an empty directory or remove it first."
    exit 1
  fi

  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
}

prepare_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
  fi
}

start_stack() {
  docker compose up -d --build
}

need_root
install_packages
sync_repo
prepare_env
start_stack

log ""
log "FoxPoint is running."
log "Project: $APP_DIR"
log "Web: http://SERVER_IP:3000"
log "API: http://SERVER_IP:4000/health"
log ""
log "Edit .env if you want custom Telegram links or support contact:"
log "  $APP_DIR/.env"
