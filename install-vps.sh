#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kzolotarev95/foxpoint_store.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/foxpoint_store}"

DB_NAME="${DB_NAME:-foxpoint}"
DB_USER="${DB_USER:-foxpoint}"
DB_PASSWORD="${DB_PASSWORD:-foxpoint}"

APP_DOMAIN="${APP_DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
SERVER_IP="${SERVER_IP:-$(hostname -I | awk '{print $1}')}"
DEPLOY_TARGET="${DEPLOY_TARGET:-}"

NEXT_PUBLIC_TG_BOT_URL="${NEXT_PUBLIC_TG_BOT_URL:-https://t.me/example_bot}"
NEXT_PUBLIC_TG_CHANNEL_URL="${NEXT_PUBLIC_TG_CHANNEL_URL:-https://t.me/fox_point_net}"
SUPPORT_CONTACT="${SUPPORT_CONTACT:-https://t.me/Fox_point_support}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
ADMIN_SESSION_SECRET="${ADMIN_SESSION_SECRET:-}"
HTTPS_ENABLED=0

log() {
  printf '%s\n' "$*"
}

get_free_space_mb() {
  df -Pm / | awk 'NR==2 {print $4}'
}

tty_print() {
  if [ -e /dev/tty ]; then
    printf '%s' "$*" > /dev/tty
  else
    printf '%s' "$*"
  fi
}

tty_read() {
  local __var_name="$1"
  local __prompt="$2"
  local __value=""

  tty_print "$__prompt"

  if [ -e /dev/tty ]; then
    IFS= read -r __value < /dev/tty || true
  elif [ -t 0 ]; then
    IFS= read -r __value || true
  fi

  printf -v "$__var_name" '%s' "$__value"
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    log "Run this script as root or with sudo."
    exit 1
  fi
}

escape_sed() {
  printf '%s' "$1" | sed 's/[\/&]/\\&/g'
}

sql_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

is_ip_address() {
  case "$1" in
    *:*)
      return 0
      ;;
    *.*)
      if printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        return 0
      fi
      ;;
  esac

  return 1
}

replace_env_key() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(escape_sed "$value")"

  if grep -q "^${key}=" "$APP_DIR/.env"; then
    sed -i "s/^${key}=.*/${key}=${escaped}/" "$APP_DIR/.env"
  else
    printf '%s=%s\n' "$key" "$value" >> "$APP_DIR/.env"
  fi
}

ensure_free_space_mb() {
  local required_mb="$1"
  local free_mb
  free_mb="$(get_free_space_mb)"

  if [ "$free_mb" -lt "$required_mb" ]; then
    log ""
    log "Not enough free disk space."
    log "Required: ${required_mb} MB"
    log "Available: ${free_mb} MB"
    log "Please free up disk space or move to a larger VPS before continuing."
    exit 1
  fi
}

cleanup_package_cache() {
  apt-get clean
  rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /root/.npm/_cacache
}

prompt_runtime_config() {
  local target_input
  local email_input

  if [ -n "$APP_DOMAIN" ] || [ -n "$DEPLOY_TARGET" ]; then
    return
  fi

  log ""
  log "FoxPoint setup needs a public address."
  log "You can enter a domain like panel.example.com or leave it empty to use this server IP."
  log "Detected server IP: $SERVER_IP"
  log ""

  tty_read target_input "Domain or IP [$SERVER_IP]: "
  target_input="${target_input:-$SERVER_IP}"
  DEPLOY_TARGET="$target_input"

  if is_ip_address "$DEPLOY_TARGET"; then
    SERVER_IP="$DEPLOY_TARGET"
    APP_DOMAIN=""
    return
  fi

  APP_DOMAIN="$DEPLOY_TARGET"
  if [ -z "$CERTBOT_EMAIL" ]; then
    tty_read email_input "Email for Let's Encrypt (leave empty to skip HTTPS for now): "
    CERTBOT_EMAIL="$email_input"
  fi
}

install_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg git nginx certbot python3-certbot-nginx postgresql postgresql-contrib
  cleanup_package_cache
}

install_node() {
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  cleanup_package_cache
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

  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
}

prepare_env() {
  local app_url
  local api_public_url
  local admin_session_secret

  cd "$APP_DIR"

  if [ ! -f .env ]; then
    cp .env.example .env
  fi

  if [ -n "$APP_DOMAIN" ]; then
    app_url="https://$APP_DOMAIN"
  else
    app_url="http://$SERVER_IP"
  fi

  api_public_url="$app_url/api"
  admin_session_secret="$ADMIN_SESSION_SECRET"

  if [ -z "$admin_session_secret" ]; then
    admin_session_secret="$(cat /proc/sys/kernel/random/uuid)$(cat /proc/sys/kernel/random/uuid)"
  fi

  replace_env_key "NODE_ENV" "production"
  replace_env_key "API_HOST" "127.0.0.1"
  replace_env_key "API_PORT" "4000"
  replace_env_key "API_BASE_URL" "http://127.0.0.1:4000"
  replace_env_key "NEXT_PUBLIC_APP_URL" "$app_url"
  replace_env_key "NEXT_PUBLIC_API_URL" "$api_public_url"
  replace_env_key "NEXT_PUBLIC_TG_BOT_URL" "$NEXT_PUBLIC_TG_BOT_URL"
  replace_env_key "NEXT_PUBLIC_TG_CHANNEL_URL" "$NEXT_PUBLIC_TG_CHANNEL_URL"
  replace_env_key "DATABASE_URL" "postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME?schema=public"
  replace_env_key "TG_BOT_URL" "$NEXT_PUBLIC_TG_BOT_URL"
  replace_env_key "TG_CHANNEL_URL" "$NEXT_PUBLIC_TG_CHANNEL_URL"
  replace_env_key "SUPPORT_CONTACT" "$SUPPORT_CONTACT"
  replace_env_key "ADMIN_USERNAME" "$ADMIN_USERNAME"
  replace_env_key "ADMIN_PASSWORD" "$ADMIN_PASSWORD"
  replace_env_key "ADMIN_SESSION_SECRET" "$admin_session_secret"
}

setup_postgres() {
  local db_user_escaped
  local db_password_escaped
  local db_name_escaped

  db_user_escaped="$(sql_escape "$DB_USER")"
  db_password_escaped="$(sql_escape "$DB_PASSWORD")"
  db_name_escaped="$(sql_escape "$DB_NAME")"

  systemctl enable --now postgresql

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${db_user_escaped}'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE ROLE \"$DB_USER\" LOGIN PASSWORD '${db_password_escaped}';"
  else
    sudo -u postgres psql -c "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD '${db_password_escaped}';"
  fi

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name_escaped}'" | grep -q 1; then
    sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
  fi
}

install_dependencies() {
  cd "$APP_DIR"
  ensure_free_space_mb 1500
  npm ci --include=optional
  npm rebuild sharp >/dev/null 2>&1 || npm install --include=optional sharp
  npm cache clean --force >/dev/null 2>&1 || true
  npm run db:generate
  systemctl restart postgresql
  npm run db:push
  ensure_free_space_mb 900
  npm run build
  rm -rf "$APP_DIR/apps/web/.next/cache" /root/.npm/_cacache
}

render_template() {
  local source="$1"
  local target="$2"
  local npm_bin="$3"
  local server_name="$4"

  sed \
    -e "s|__APP_DIR__|$(escape_sed "$APP_DIR")|g" \
    -e "s|__NPM_BIN__|$(escape_sed "$npm_bin")|g" \
    -e "s|__SERVER_NAME__|$(escape_sed "$server_name")|g" \
    "$source" > "$target"
}

install_systemd_units() {
  local npm_bin
  npm_bin="$(command -v npm)"

  render_template "$APP_DIR/deploy/systemd/foxpoint-api.service" "/etc/systemd/system/foxpoint-api.service" "$npm_bin" "_"
  render_template "$APP_DIR/deploy/systemd/foxpoint-web.service" "/etc/systemd/system/foxpoint-web.service" "$npm_bin" "_"

  systemctl daemon-reload
  systemctl enable foxpoint-api foxpoint-web
  systemctl restart foxpoint-api foxpoint-web
}

setup_nginx() {
  local server_name

  if [ -n "$APP_DOMAIN" ]; then
    server_name="$APP_DOMAIN"
  else
    server_name="_"
  fi

  render_template "$APP_DIR/deploy/nginx/foxpoint.conf" "/etc/nginx/sites-available/foxpoint" "$(command -v npm)" "$server_name"

  rm -f /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/foxpoint /etc/nginx/sites-enabled/foxpoint
  nginx -t
  systemctl reload nginx
}

setup_nginx_8443() {
  local cert_dir

  if [ -z "$APP_DOMAIN" ]; then
    return
  fi

  cert_dir="/etc/letsencrypt/live/$APP_DOMAIN"
  if [ ! -f "$cert_dir/fullchain.pem" ] || [ ! -f "$cert_dir/privkey.pem" ]; then
    return
  fi

  render_template "$APP_DIR/deploy/nginx/foxpoint-8443.conf" "/etc/nginx/sites-available/foxpoint-8443" "$(command -v npm)" "$APP_DOMAIN"
  ln -sf /etc/nginx/sites-available/foxpoint-8443 /etc/nginx/sites-enabled/foxpoint-8443
  nginx -t
  systemctl reload nginx
}

enable_https_if_ready() {
  if [ -z "$APP_DOMAIN" ] || [ -z "$CERTBOT_EMAIL" ]; then
    log ""
    log "HTTPS was skipped."
    log "When DNS is ready, rerun with:"
    log "  sudo APP_DOMAIN=panel.example.com CERTBOT_EMAIL=you@example.com bash install-vps.sh"
    return
  fi

  if certbot --nginx --non-interactive --agree-tos -m "$CERTBOT_EMAIL" -d "$APP_DOMAIN" --redirect; then
    HTTPS_ENABLED=1
    setup_nginx_8443
    return
  fi

  log ""
  log "HTTPS setup failed for $APP_DOMAIN."
  log "FoxPoint is still installed and available over HTTP."
  log "Most common causes: port 80 is blocked, port 80 is used by another service, or DNS is not pointing to this server yet."
  log "Check listeners with: ss -ltnp | grep -E ':(80|443)\\b'"
  log "Check firewall with: ufw status"
  log "Retry HTTPS later with:"
  log "  certbot --nginx --non-interactive --agree-tos -m $CERTBOT_EMAIL -d $APP_DOMAIN --redirect"
}

show_summary() {
  log ""
  log "FoxPoint is installed without Docker."
  log "Project: $APP_DIR"
  log "Web local: http://127.0.0.1:3000"
  log "API local: http://127.0.0.1:4000/health"
  log "Server IP: $SERVER_IP"

  if [ -n "$APP_DOMAIN" ] && [ "$HTTPS_ENABLED" -eq 1 ]; then
    log "Public URL: https://$APP_DOMAIN"
  elif [ -n "$APP_DOMAIN" ]; then
    log "Public URL: http://$APP_DOMAIN"
  else
    log "Public URL: http://$SERVER_IP"
  fi

  log ""
  log "Useful commands:"
  log "  systemctl status foxpoint-api foxpoint-web"
  log "  journalctl -u foxpoint-api -n 100 --no-pager"
  log "  journalctl -u foxpoint-web -n 100 --no-pager"
  log "  curl http://127.0.0.1:4000/health"
}

need_root
prompt_runtime_config
install_base_packages
install_node
sync_repo
prepare_env
setup_postgres
install_dependencies
install_systemd_units
setup_nginx
enable_https_if_ready
show_summary
