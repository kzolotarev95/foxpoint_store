import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const MAGIC = Buffer.from("FOXPOINT-BACKUP1\n");
const scrypt = promisify(scryptCallback);
export const appRoot = resolve(process.env.FOXPOINT_APP_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url)));
export const backupRoot = resolve(process.env.FOXPOINT_BACKUP_DIR ?? (process.platform === "linux" ? "/opt/foxpoint-panel-backups" : join(appRoot, ".codex-temp/panel-backups")));
export const MAX_ARCHIVE_BYTES = 20 * 1024 ** 3;
export type BackupManifest = {
  format: "FOXPOINT_FULL_BACKUP";
  version: 1;
  createdAt: string;
  applicationRoot: string;
  publicUrl: string;
  postgresMajor: number;
  nodeMajor: number;
  databaseSha256: string;
  databaseBytes: number;
  tables: Array<{ name: string; rows: number }>;
  systemFiles: string[];
  npmBinary: string;
};
export type BackupJob = {
  id: string;
  kind: "create" | "upload" | "restore";
  status: "running" | "ready" | "failed" | "restored";
  step: string;
  createdAt: string;
  updatedAt: string;
  bytes?: number;
  manifest?: BackupManifest;
  error?: string;
  targetUrl?: string;
  archiveId?: string;
};

export async function readEnvironment(path: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

export async function command(binary: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((accept, reject) => {
    const child = spawn(binary, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Превышено время операции ${binary.split(/[\\/]/).pop()}.`)); }, options.timeout ?? 30 * 60 * 1000);
    child.stdout.on("data", chunk => { output += chunk; if (output.length > 4 * 1024 * 1024) { child.kill(); reject(new Error("Слишком большой ответ служебной команды.")); } });
    child.stderr.on("data", chunk => { errors = (errors + chunk).slice(-8000); });
    child.stdin.on("error", () => { /* The child reports the operation error through its exit status. */ });
    child.on("error", () => { clearTimeout(timer); reject(new Error(`Не найдена служебная программа ${binary.split(/[\\/]/).pop()}.`)); });
    child.on("close", code => { clearTimeout(timer); code === 0 ? accept(output.trim()) : reject(new Error(`${binary.split(/[\\/]/).pop()}: ${errors.trim() || `код завершения ${code}`}`)); });
    child.stdin.end(options.input);
  });
}

function pgBinary(name: string, major?: number) {
  if (process.env.FOXPOINT_PG_BIN) return join(process.env.FOXPOINT_PG_BIN, `${name}${process.platform === "win32" ? ".exe" : ""}`);
  // Debian/Ubuntu wrappers otherwise select the newest installed client, which can emit settings unsupported by the saved server version.
  if (process.platform === "linux" && major) return `/usr/lib/postgresql/${major}/bin/${name}`;
  return name;
}
function postgresEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL должен указывать PostgreSQL.");
  return { PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer", PGCONNECT_TIMEOUT: "15" };
}
async function sql(databaseUrl: string, query: string) { return command(pgBinary("psql"), ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"], { env: postgresEnv(databaseUrl), input: query }); }
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export function validatePassword(password: string) {
  if (password.length < 12 || password.length > 256) throw new Error("Пароль архива должен содержать от 12 до 256 символов.");
}
export function validateJobId(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Неверный идентификатор копии."); return id; }
export function jobPath(id: string) { return join(backupRoot, `${validateJobId(id)}.json`); }
export function archivePath(id: string) { return join(backupRoot, `${validateJobId(id)}.foxbackup`); }
export async function updateJob(job: BackupJob, patch: Partial<BackupJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await chmod(backupRoot, 0o700);
  const partial = `${jobPath(job.id)}.partial`;
  await writeFile(partial, JSON.stringify(job, null, 2), { mode: 0o600 });
  await rename(partial, jobPath(job.id));
}
export async function listJobs(): Promise<BackupJob[]> {
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const files = (await readdir(backupRoot)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
  const results = await Promise.all(files.map(async name => JSON.parse(await readFile(join(backupRoot, name), "utf8")) as BackupJob));
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getJob(id: string): Promise<BackupJob> { return JSON.parse(await readFile(jobPath(id), "utf8")); }

const operationLock = join(backupRoot, "operation.lock");
export async function backupBusy(): Promise<boolean> {
  const lock = await readFile(operationLock, "utf8").then(value => JSON.parse(value) as { id: string; pid: number }).catch(() => null);
  if (!lock) return false;
  const completed = await getJob(lock.id).catch(() => null);
  if (completed && completed.status !== "running") { await rm(operationLock, { force: true }); return false; }
  try { process.kill(lock.pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") return true; }
  const job = await getJob(lock.id).catch(() => null);
  if (job?.status === "running") await updateJob(job, { status: "failed", step: "Операция прервана перезапуском", error: "Создайте или загрузите архив повторно. Готовые копии сохранены." });
  await rm(operationLock, { force: true });
  return false;
}
export async function acquireBackupLock(job: BackupJob) {
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  if (await backupBusy()) throw new Error("Дождитесь завершения текущей операции.");
  const handle = await open(operationLock, "wx", 0o600).catch(() => { throw new Error("Дождитесь завершения текущей операции."); });
  await handle.writeFile(JSON.stringify({ id: job.id, pid: process.pid }));
  await handle.close();
  if (process.platform === "linux") {
    try { await command("flock", ["-n", "/var/lock/foxpoint-local-fix.lock", "true"]); }
    catch { await releaseBackupLock(job.id); throw new Error("Сейчас устанавливается обновление панели. Дождитесь завершения."); }
  }
}
export async function takeOverBackupLock(id: string) {
  const lock = JSON.parse(await readFile(operationLock, "utf8")) as { id: string };
  if (lock.id !== id) throw new Error("Восстановление не владеет блокировкой панели.");
  await writeFile(operationLock, JSON.stringify({ id, pid: process.pid }), { mode: 0o600 });
}
export async function releaseBackupLock(id: string) {
  const lock = await readFile(operationLock, "utf8").then(value => JSON.parse(value) as { id: string }).catch(() => null);
  if (lock?.id === id) await rm(operationLock, { force: true });
}
export async function backupWorkerStarted(id: string) {
  const lock = await readFile(operationLock, "utf8").then(value => JSON.parse(value) as { id: string; pid: number }).catch(() => null);
  return lock?.id === id && lock.pid !== process.pid;
}

async function encrypt(source: string, target: string, password: string) {
  validatePassword(password);
  const salt = randomBytes(16), iv = randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const key = await scrypt(password, salt, 32) as Buffer;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const file = await open(`${target}.partial`, "wx", 0o600);
  await file.write(header);
  await file.close();
  try {
    await pipeline(createReadStream(source), cipher, createWriteStream(`${target}.partial`, { flags: "a", mode: 0o600 }));
    const handle = await open(`${target}.partial`, "a");
    await handle.write(cipher.getAuthTag());
    await handle.close();
    if ((await stat(`${target}.partial`)).size > MAX_ARCHIVE_BYTES) throw new Error("Полный архив превышает допустимый размер 20 ГБ.");
    await rename(`${target}.partial`, target);
  } finally { key.fill(0); await rm(`${target}.partial`, { force: true }); }
}

async function decrypt(source: string, target: string, password: string) {
  validatePassword(password);
  const size = (await stat(source)).size;
  const headerSize = MAGIC.length + 16 + 12;
  if (size < headerSize + 17 || size > MAX_ARCHIVE_BYTES) throw new Error("Неверный размер архива FOX POINT.");
  const handle = await open(source, "r");
  const header = Buffer.alloc(headerSize), tag = Buffer.alloc(16);
  await handle.read(header, 0, header.length, 0);
  await handle.read(tag, 0, tag.length, size - 16);
  await handle.close();
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Загрузите файл полного бэкапа .foxbackup.");
  const key = await scrypt(password, header.subarray(MAGIC.length, MAGIC.length + 16), 32) as Buffer;
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length + 16));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(source, { start: headerSize, end: size - 17 }), decipher, createWriteStream(target, { flags: "wx", mode: 0o600 }));
  } catch { await rm(target, { force: true }); throw new Error("Пароль неверен или архив повреждён. Восстановление не начато."); }
  finally { key.fill(0); }
}

async function tableCounts(databaseUrl: string) {
  const names = JSON.parse(await sql(databaseUrl, "SELECT COALESCE(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public';")) as string[];
  const result = [];
  for (const name of names) result.push({ name, rows: Number(await sql(databaseUrl, `SELECT count(*) FROM public.${quoteIdentifier(name)};`)) });
  return result;
}

async function copySystemFiles(destination: string, publicUrl: string): Promise<string[]> {
  if (process.platform !== "linux") return [];
  const host = new URL(publicUrl).hostname;
  const paths = ["/etc/nginx/sites-available/foxpoint", "/etc/systemd/system/foxpoint-api.service", "/etc/systemd/system/foxpoint-web.service",
    "/etc/letsencrypt/options-ssl-nginx.conf", "/etc/letsencrypt/ssl-dhparams.pem"];
  if (/^[a-zA-Z0-9.-]+$/.test(host)) paths.push(`/etc/letsencrypt/live/${host}`, `/etc/letsencrypt/archive/${host}`, `/etc/letsencrypt/renewal/${host}.conf`, "/etc/letsencrypt/accounts");
  const copied = [];
  for (const source of paths) {
    try { await stat(source); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const target = join(destination, source.slice(1));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await cp(source, target, { recursive: true, dereference: true });
    copied.push(source);
  }
  return copied;
}

export async function createFullBackup(options: { password: string; output: string; root?: string; databaseUrl?: string; helper?: string; progress?: (step: string) => Promise<void> }): Promise<BackupManifest> {
  const root = resolve(options.root ?? appRoot);
  validatePassword(options.password);
  const settings = { ...await readEnvironment(join(root, ".env")), ...process.env };
  const databaseUrl = options.databaseUrl ?? settings.DATABASE_URL;
  if (!databaseUrl) throw new Error("Не задан DATABASE_URL для полной копии.");
  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(dirname(options.output), ".creating-"));
  await chmod(temporary, 0o700);
  try {
    const payload = join(temporary, "payload");
    await mkdir(payload, { mode: 0o700 });
    const dump = join(payload, "database.dump");
    await options.progress?.("Сохраняем всю базу данных");
    const postgresMajor = Math.floor(Number(await sql(databaseUrl, "SHOW server_version_num;")) / 10000);
    await command(pgBinary("pg_dump", postgresMajor), ["--format=custom", "--no-owner", "--no-acl", "--file", dump], { env: postgresEnv(databaseUrl) });
    await command(pgBinary("pg_restore", postgresMajor), ["--list", dump]);
    const publicUrl = settings.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const systemFiles = await copySystemFiles(join(payload, "system"), publicUrl);
    const manifest: BackupManifest = { format: "FOXPOINT_FULL_BACKUP", version: 1, createdAt: new Date().toISOString(), applicationRoot: root, publicUrl,
      postgresMajor, nodeMajor: Number(process.versions.node.split(".")[0]), databaseSha256: await hashFile(dump), databaseBytes: (await stat(dump)).size,
      tables: await tableCounts(databaseUrl), systemFiles, npmBinary: process.platform === "linux" ? await command("which", ["npm"]) : "npm" };
    await writeFile(join(payload, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await options.progress?.("Сохраняем приложение, файлы и настройки");
    const packed = join(temporary, "panel.tar.gz");
    await command(process.env.FOXPOINT_PYTHON ?? (process.platform === "win32" ? "python" : "python3"), [options.helper ?? join(appRoot, "scripts/panel-backup-archive.py"), "pack", root, payload, packed]);
    await options.progress?.("Защищаем архив паролем");
    await encrypt(packed, options.output, options.password);
    return manifest;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function inspectFullBackup(options: { archive: string; password: string; destination: string; helper?: string }): Promise<BackupManifest> {
  await mkdir(options.destination, { recursive: true, mode: 0o700 });
  await chmod(options.destination, 0o700);
  const packed = join(options.destination, "panel.tar.gz");
  const extracted = join(options.destination, "contents");
  await decrypt(options.archive, packed, options.password);
  await command(process.env.FOXPOINT_PYTHON ?? (process.platform === "win32" ? "python" : "python3"), [options.helper ?? join(appRoot, "scripts/panel-backup-archive.py"), "unpack", packed, extracted]);
  const manifest = JSON.parse(await readFile(join(extracted, "backup/manifest.json"), "utf8")) as BackupManifest;
  if (manifest.format !== "FOXPOINT_FULL_BACKUP" || manifest.version !== 1 || !Number.isInteger(manifest.postgresMajor) || manifest.postgresMajor < 14 || manifest.postgresMajor > 99 || !Number.isInteger(manifest.nodeMajor) || manifest.nodeMajor < 18 || manifest.nodeMajor > 99 || typeof manifest.applicationRoot !== "string" || !manifest.applicationRoot || typeof manifest.npmBinary !== "string" || !manifest.npmBinary || typeof manifest.publicUrl !== "string" || !/^https?:\/\//.test(manifest.publicUrl) || !/^[a-f0-9]{64}$/.test(manifest.databaseSha256) || !Array.isArray(manifest.systemFiles) || !manifest.systemFiles.every(path => typeof path === "string") || !Array.isArray(manifest.tables) || !manifest.tables.every(table => typeof table.name === "string" && Number.isSafeInteger(table.rows) && table.rows >= 0)) throw new Error("Неподдерживаемый формат полного бэкапа.");
  if (await hashFile(join(extracted, "backup/database.dump")) !== manifest.databaseSha256) throw new Error("Контрольная сумма базы не совпала. Восстановление не начато.");
  return manifest;
}

// Shared by the server restorer and the real PostgreSQL round-trip test.
export async function restoreDatabase(dump: string, databaseUrl: string, postgresMajor?: number) {
  await command(pgBinary("pg_restore", postgresMajor), ["--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "--dbname", decodeURIComponent(new URL(databaseUrl).pathname.slice(1)), dump], { env: postgresEnv(databaseUrl) });
}

export function publicTargetUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.port) throw new Error("Укажите адрес сайта без пути и порта, например https://panel.example.com.");
  return url.origin;
}

async function writeRestoredEnv(path: string, databaseUrl: string, targetUrl: string) {
  const original = await readFile(path, "utf8");
  const values: Record<string, string> = { DATABASE_URL: databaseUrl, API_HOST: "127.0.0.1", API_PORT: "4000", API_BASE_URL: "http://127.0.0.1:4000", NEXT_PUBLIC_APP_URL: targetUrl, NEXT_PUBLIC_API_URL: `${targetUrl}/api`, API_PUBLIC_URL: `${targetUrl}/api`, NODE_ENV: "production" };
  let content = original;
  for (const [key, value] of Object.entries(values)) {
    const matcher = new RegExp(`^${key}=.*$`, "m");
    content = matcher.test(content) ? content.replace(matcher, `${key}=${value}`) : `${content}\n${key}=${value}\n`;
  }
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function restoreFullBackup(options: { archive: string; password: string; targetUrl: string; root?: string; helper?: string; progress?: (step: string) => Promise<void>; beforeBackup?: (manifest: BackupManifest, file: string) => Promise<void>; workDirectory?: string }): Promise<void> {
  if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("Полное восстановление запускается на Linux VPS с правами администратора сервера.");
  const root = resolve(options.root ?? appRoot);
  if (root !== "/opt/foxpoint_store") throw new Error("Ожидается установка в /opt/foxpoint_store.");
  if ((await lstat(root).catch(() => null))?.isSymbolicLink()) throw new Error("Каталог панели является ссылкой; автоматическое восстановление не поддерживается.");
  const targetUrl = publicTargetUrl(options.targetUrl);
  const work = options.workDirectory ?? await mkdtemp(join(backupRoot, ".restore-"));
  await mkdir(work, { recursive: true, mode: 0o700 });
  await chmod(work, 0o700);
  await mkdir(dirname(root), { recursive: true });
  if ((await stat(work)).dev !== (await stat(dirname(root))).dev) throw new Error("Рабочий каталог восстановления должен быть на том же диске, что /opt/foxpoint_store.");
  const previousApp = join(work, "app-before");
  let switched = false;
  let previousMoved = false;
  let servicesStopped = false;
  let oldNginx: string | null = null;
  let oldNginxLink: string | null = null;
  let oldDefaultLink: string | null = null;
  const oldUnits = new Map<string, string | null>();
  try {
    await options.progress?.("Проверяем полный архив");
    const manifest = await inspectFullBackup({ archive: options.archive, password: options.password, destination: work, helper: options.helper });
    const contents = join(work, "contents");
    const candidate = join(contents, "app");
    const major = Math.floor(Number(await command("runuser", ["-u", "postgres", "--", "psql", "-XAt", "-c", "SHOW server_version_num;"])) / 10000);
    if (!Number.isInteger(major)) throw new Error("Не удалось определить версию PostgreSQL.");
    if (major !== manifest.postgresMajor) throw new Error(`Для этого архива нужна PostgreSQL ${manifest.postgresMajor}. На сервере PostgreSQL ${major}; установите исходную версию, чтобы сохранить совместимость базы.`);
    if (Number(process.versions.node.split(".")[0]) < manifest.nodeMajor) throw new Error(`Для сохранённой версии приложения нужен Node.js ${manifest.nodeMajor} или новее. Текущая панель не изменена.`);
    const sourceHost = new URL(manifest.publicUrl).hostname;
    const targetHost = new URL(targetUrl).hostname;
    const certificates = join(contents, "backup/system/etc/letsencrypt/live", sourceHost);
    if (targetUrl.startsWith("https:") && (sourceHost !== targetHost || !(await stat(join(certificates, "fullchain.pem")).catch(() => null)))) throw new Error("Для нового адреса сначала восстановите на http://адрес-сервера, затем подключите HTTPS.");
    const id = randomBytes(6).toString("hex");
    const databaseName = `foxpoint_restored_${id}`;
    const databasePassword = randomBytes(32).toString("hex");
    const databaseUrl = `postgresql://${databaseName}:${databasePassword}@127.0.0.1:5432/${databaseName}?schema=public`;
    await options.progress?.("Восстанавливаем данные в отдельную базу PostgreSQL");
    await command("runuser", ["-u", "postgres", "--", "psql", "-X", "-v", "ON_ERROR_STOP=1"], { input: `CREATE ROLE ${quoteIdentifier(databaseName)} LOGIN PASSWORD ${quoteLiteral(databasePassword)};\nCREATE DATABASE ${quoteIdentifier(databaseName)} OWNER ${quoteIdentifier(databaseName)};\n` });
    await restoreDatabase(join(contents, "backup/database.dump"), databaseUrl, manifest.postgresMajor);
    // Public addresses exist in the database as well as .env; update both for the destination server.
    await sql(databaseUrl, `UPDATE public."AppSetting" SET value=${quoteLiteral(targetUrl)}, "updatedAt"=now() WHERE key='app_url';\nUPDATE public."AppSetting" SET value=${quoteLiteral(`${targetUrl}/api`)}, "updatedAt"=now() WHERE key='api_public_url';`);
    await writeRestoredEnv(join(candidate, ".env"), databaseUrl, targetUrl);
    await options.progress?.("Собираем сохранённую версию приложения");
    const env = await readEnvironment(join(candidate, ".env"));
    await command("npm", ["ci", "--include=dev", "--include=optional", "--no-audit"], { cwd: candidate, env });
    await command("npm", ["run", "db:generate"], { cwd: candidate, env });
    await command("npm", ["run", "build"], { cwd: candidate, env });
    // The saved schema is restored by pg_restore. Never db push or re-import the client register here.
    const previousEnv = await readEnvironment(join(root, ".env")).catch(() => null);
    if ((await stat(root).catch(() => null)) && !previousEnv?.DATABASE_URL) throw new Error("В существующем каталоге панели нет корректного .env/DATABASE_URL. Замена отменена, чтобы не потерять текущее состояние.");
    oldNginx = await readFile("/etc/nginx/sites-available/foxpoint", "utf8").catch(() => null);
    oldNginxLink = await command("readlink", ["/etc/nginx/sites-enabled/foxpoint"]).catch(() => null);
    oldDefaultLink = await command("readlink", ["/etc/nginx/sites-enabled/default"]).catch(() => null);
    for (const service of ["foxpoint-api", "foxpoint-web"]) {
      oldUnits.set(service, await readFile(`/etc/systemd/system/${service}.service`, "utf8").catch(() => null));
      const existing = await command("systemctl", ["show", service, "--property=WorkingDirectory", "--value"]).catch(() => "");
      if (existing && existing !== root) throw new Error("Сервисы настроены на другой каталог. Текущая панель не изменена.");
    }
    await options.progress?.("Переключаем панель на восстановленную версию");
    servicesStopped = true;
    for (const [service, source] of oldUnits) if (source) await command("systemctl", ["stop", service]);
    if (previousEnv?.DATABASE_URL) {
      await options.progress?.("Создаём полный бэкап текущей панели перед заменой");
      const file = join(work, "before-restore.foxbackup");
      const before = await createFullBackup({ password: options.password, output: file, root, databaseUrl: previousEnv.DATABASE_URL, helper: options.helper });
      await options.beforeBackup?.(before, file);
    }
    if (await stat(root).catch(() => null)) { await rename(root, previousApp); previousMoved = true; }
    await rename(candidate, root);
    switched = true;
    const npm = await command("which", ["npm"]);
    const capturedSystem = join(contents, "backup/system");
    await mkdir("/etc/systemd/system", { recursive: true });
    for (const service of ["foxpoint-api", "foxpoint-web"]) {
      const saved = await readFile(join(capturedSystem, `etc/systemd/system/${service}.service`), "utf8").catch(() => null);
      const template = saved ?? await readFile(join(root, `deploy/systemd/${service}.service`), "utf8");
      const rendered = template.replaceAll(manifest.applicationRoot, root).replaceAll("__APP_DIR__", root).replaceAll(manifest.npmBinary, npm).replaceAll("__NPM_BIN__", npm);
      await writeFile(`/etc/systemd/system/${service}.service`, rendered);
    }
    if (sourceHost === targetHost && targetUrl.startsWith("https:")) {
      for (const path of manifest.systemFiles.filter(path => path.startsWith("/etc/letsencrypt/"))) {
        if (!/^\/etc\/letsencrypt\/(options-ssl-nginx\.conf|ssl-dhparams\.pem|(?:live|archive)\/[a-zA-Z0-9.-]+|renewal\/[a-zA-Z0-9.-]+\.conf|accounts)$/.test(path)) throw new Error("Недопустимый путь сертификата.");
        // Keep current certificates when present; the archive may contain an older renewal.
        if (await stat(path).catch(() => null)) continue;
        await mkdir(dirname(path), { recursive: true });
        await cp(join(capturedSystem, path.slice(1)), path, { recursive: true, dereference: true });
      }
    }
    await mkdir("/etc/nginx/sites-available", { recursive: true });
    await mkdir("/etc/nginx/sites-enabled", { recursive: true });
    const savedNginx = sourceHost === targetHost && new URL(manifest.publicUrl).protocol === new URL(targetUrl).protocol ? await readFile(join(capturedSystem, "etc/nginx/sites-available/foxpoint"), "utf8").catch(() => null) : null;
    const nginx = savedNginx ?? await readFile(join(root, `deploy/nginx/${targetUrl.startsWith("https:") ? "foxpoint-tls.conf" : "foxpoint.conf"}`), "utf8");
    await writeFile("/etc/nginx/sites-available/foxpoint", nginx.replaceAll(manifest.applicationRoot, root).replaceAll("__APP_DIR__", root).replaceAll("__SERVER_NAME__", targetHost));
    if (!previousEnv && oldDefaultLink) await rm("/etc/nginx/sites-enabled/default", { force: true });
    await command("ln", ["-sfn", "/etc/nginx/sites-available/foxpoint", "/etc/nginx/sites-enabled/foxpoint"]);
    await command("nginx", ["-t"]);
    await command("systemctl", ["daemon-reload"]);
    await command("systemctl", ["reset-failed", "foxpoint-api", "foxpoint-web"]).catch(() => undefined);
    await command("systemctl", ["enable", "foxpoint-api", "foxpoint-web", "nginx"]);
    await command("systemctl", ["start", "foxpoint-api", "foxpoint-web", "nginx"]);
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const health = await fetch("http://127.0.0.1:4000/health", { signal: AbortSignal.timeout(4000) }).then(response => response.json()) as { database?: string };
        const web = await fetch("http://127.0.0.1:3000/admin/login", { signal: AbortSignal.timeout(4000) });
        if (health.database === "up" && web.ok) { ready = true; break; }
      } catch { /* Services are starting. */ }
      await new Promise(accept => setTimeout(accept, 1500));
    }
    if (!ready) throw new Error("Восстановленная версия не прошла проверку запуска.");
    await command("systemctl", ["reload", "nginx"]);
    await writeFile(join(work, "restored.txt"), `Полная панель восстановлена ${new Date().toISOString()}\nАдрес: ${targetUrl}\nПредыдущая версия: ${previousApp}\n`, { mode: 0o600 });
    await options.progress?.("Панель, база, файлы и настройки восстановлены");
  } catch (error) {
    if (switched || previousMoved) {
      await command("systemctl", ["stop", "foxpoint-web", "foxpoint-api"]).catch(() => undefined);
      if (switched) await rename(root, join(work, "app-rejected"));
      if (previousMoved) await rename(previousApp, root);
      if (oldNginx !== null) await writeFile("/etc/nginx/sites-available/foxpoint", oldNginx);
      else { await rm("/etc/nginx/sites-enabled/foxpoint", { force: true }); await rm("/etc/nginx/sites-available/foxpoint", { force: true }); }
      if (oldNginxLink !== null) await command("ln", ["-sfn", oldNginxLink, "/etc/nginx/sites-enabled/foxpoint"]);
      else await rm("/etc/nginx/sites-enabled/foxpoint", { force: true });
      if (oldDefaultLink) await command("ln", ["-sfn", oldDefaultLink, "/etc/nginx/sites-enabled/default"]);
      for (const [service, source] of oldUnits) {
        if (source) await writeFile(`/etc/systemd/system/${service}.service`, source);
        else await rm(`/etc/systemd/system/${service}.service`, { force: true });
      }
      await command("systemctl", ["daemon-reload"]).catch(() => undefined);
      await command("systemctl", ["reload", "nginx"]).catch(() => undefined);
    }
    if (servicesStopped) for (const [service, source] of oldUnits) if (source) {
      await command("systemctl", ["reset-failed", service]).catch(() => undefined);
      await command("systemctl", ["start", service]).catch(() => undefined);
    }
    throw error;
  }
}
