#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
if [ "$(id -u)" -ne 0 ]; then echo "Запустите с sudo." >&2; exit 1; fi
if [ "$#" -lt 2 ]; then echo "sudo bash restore-foxpoint.sh /root/backup.foxbackup http://NEW-SERVER-IP" >&2; exit 1; fi
ARCHIVE="$(realpath "$1")"
TARGET_URL="$2"
[[ -s "$ARCHIVE" ]] || { echo "Полный архив не найден." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git python3 postgresql postgresql-contrib nginx util-linux certbot python3-certbot-nginx
if ! command -v node >/dev/null || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
systemctl enable --now postgresql
mkdir -p /opt
WORK="$(mktemp -d /opt/foxpoint-restore.XXXXXXXX)"
chmod 700 "$WORK"
trap 'echo "Файлы операции: $WORK"' EXIT
base64 -d > "$WORK/full-backup.mjs" <<'FOXPOINT_BACKUP_MODULE'
__FOXPOINT_BACKUP_MODULE_BASE64__
FOXPOINT_BACKUP_MODULE
base64 -d > "$WORK/archive.py" <<'FOXPOINT_ARCHIVE_HELPER'
__FOXPOINT_ARCHIVE_HELPER_BASE64__
FOXPOINT_ARCHIVE_HELPER
cat > "$WORK/run.mjs" <<'FOXPOINT_RESTORE_RUNNER'
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectFullBackup, restoreFullBackup } from "./full-backup.mjs";
const [archive, targetUrl] = process.argv.slice(2);
const work = new URL("./", import.meta.url).pathname;
process.stderr.write("Пароль полного архива: ");
spawnSync("stty", ["-echo"], { stdio: [0, 2, 2] });
let password = "";
try {
  password = await new Promise(resolve => { process.stdin.setEncoding("utf8"); process.stdin.once("data", chunk => resolve(String(chunk).replace(/[\r\n]+$/, ""))); process.stdin.resume(); });
} finally { spawnSync("stty", ["echo"], { stdio: [0, 2, 2] }); process.stderr.write("\n"); process.stdin.pause(); }
const verification = join(work, "verification");
const manifest = await inspectFullBackup({ archive, password, destination: verification, helper: join(work, "archive.py") });
await rm(verification, { recursive: true, force: true });
if (Number(process.versions.node.split(".")[0]) < manifest.nodeMajor) throw new Error(`Установите Node.js ${manifest.nodeMajor} или новее и повторите восстановление.`);
const actual = spawnSync("runuser", ["-u", "postgres", "--", "psql", "-XAt", "-c", "SHOW server_version_num;"], { encoding: "utf8" });
const major = Math.floor(Number(actual.stdout.trim()) / 10000);
if (actual.status !== 0 || !Number.isInteger(major)) throw new Error("Не удалось определить версию PostgreSQL.");
if (major !== manifest.postgresMajor) {
  const { existsSync } = await import("node:fs");
  if (existsSync("/opt/foxpoint_store/.env")) throw new Error(`На существующем сервере включите PostgreSQL ${manifest.postgresMajor} вручную. Панель не изменена.`);
  process.stderr.write(`Устанавливаем PostgreSQL ${manifest.postgresMajor} для сохранённой базы.\n`);
  const configured = spawnSync("bash", ["/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh", "-y"], { stdio: "inherit" });
  if (configured.status !== 0) throw new Error("Не удалось настроить официальный репозиторий PostgreSQL.");
  for (const args of [["update"], ["install", "-y", `postgresql-${manifest.postgresMajor}`, `postgresql-client-${manifest.postgresMajor}`]]) {
    if (spawnSync("apt-get", args, { stdio: "inherit" }).status !== 0) throw new Error("Не удалось установить подходящую PostgreSQL.");
  }
  if (spawnSync("systemctl", ["stop", "postgresql"], { stdio: "inherit" }).status !== 0) throw new Error("Не удалось остановить новую PostgreSQL.");
  // Only a fresh server can change its PostgreSQL port automatically.
  for (const version of [major, manifest.postgresMajor]) {
    const file = `/etc/postgresql/${version}/main/postgresql.conf`;
    const source = await readFile(file, "utf8");
    await writeFile(file, source.replace(/^port\s*=.*$/m, `port = ${version === manifest.postgresMajor ? 5432 : 55432}`));
  }
  if (spawnSync("systemctl", ["start", "postgresql"], { stdio: "inherit" }).status !== 0) throw new Error("Не удалось запустить PostgreSQL.");
}
await mkdir("/opt/foxpoint-panel-backups", { recursive: true, mode: 0o700 });
await restoreFullBackup({ archive, password, targetUrl, root: "/opt/foxpoint_store", helper: join(work, "archive.py"), workDirectory: join(work, "operation"), progress: async step => { console.log(step); } });
password = "";
console.log(`Полная панель восстановлена. Админка: ${targetUrl}/admin/login`);
console.log("Используйте логин и пароль администратора из сохранённого бэкапа.");
FOXPOINT_RESTORE_RUNNER
export FOXPOINT_BACKUP_DIR=/opt/foxpoint-panel-backups
flock -n /var/lock/foxpoint-local-fix.lock node "$WORK/run.mjs" "$ARCHIVE" "$TARGET_URL" < /dev/tty
