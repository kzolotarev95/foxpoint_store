import assert from "node:assert/strict";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminSessionToken } from "../apps/api/dist/admin-auth.js";
import { config } from "../apps/api/dist/config.js";
const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../.codex-temp");
await mkdir(testRoot, { recursive: true });
const directory = await mkdtemp(join(testRoot, "backup-routes-test-"));
if (!directory.startsWith(testRoot + sep)) throw new Error("Test directory must stay inside .codex-temp.");
process.env.FOXPOINT_BACKUP_DIR = directory;
const { registerBackupRoutes } = await import("../apps/api/dist/backup-routes.js");
const { acquireBackupLock, archivePath, backupBusy, jobPath, releaseBackupLock, updateJob } = await import("../apps/api/dist/full-backup.js");
const app = Fastify();
await app.register(sensible);
await registerBackupRoutes(app);
try {
  for (const url of ["/api/admin/backups", "/api/admin/backups/installer", "/api/admin/backups/00000000-0000-0000-0000-000000000000/download"]) {
    assert.equal((await app.inject({ url, remoteAddress: "127.0.0.1" })).statusCode, 401);
    assert.equal((await app.inject({ url, headers: { "x-admin-session": "forged.session" } })).statusCode, 401);
  }
  const headers = { "x-admin-session": createAdminSessionToken(config.ADMIN_USERNAME) };
  const list = await app.inject({ url: "/api/admin/backups", headers });
  assert.equal(list.statusCode, 200); assert.equal(list.headers["cache-control"], "no-store");
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/backups", headers, payload: { password: "short" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/backups/00000000-0000-0000-0000-000000000000/restore", headers, payload: { password: "test-password-2026", targetUrl: "http://127.0.0.1", confirmation: "YES" } })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/admin/backups/00000000-0000-0000-0000-000000000000/download", headers })).statusCode, 404);
  const installer = await app.inject({ url: "/api/admin/backups/installer", headers });
  assert.equal(installer.statusCode, 200);
  assert(!installer.body.includes("__FOXPOINT_BACKUP_MODULE_BASE64__"));
  assert(!installer.body.includes("__FOXPOINT_ARCHIVE_HELPER_BASE64__"));

  const fixture = async (patch = {}) => {
    const job = { id: randomUUID(), kind: "create", status: "ready", step: "Disposable deletion test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...patch };
    await updateJob(job, {});
    await writeFile(archivePath(job.id), Buffer.alloc(2048, 7));
    return job;
  };
  const saved = await fixture();
  const keeper = await fixture();
  const remove = (id, payload = { confirmation: "УДАЛИТЬ" }, auth = headers) => app.inject({ method: "POST", url: `/api/admin/backups/${id}/delete`, headers: auth, payload });
  const exists = async path => stat(path).then(() => true).catch(error => { if (error.code === "ENOENT") return false; throw error; });
  assert.equal((await remove(saved.id, undefined, {})).statusCode, 401);
  assert.equal((await remove(saved.id, undefined, { "x-admin-session": "forged.session" })).statusCode, 401);
  assert.equal((await remove(saved.id, {})).statusCode, 400);
  assert.equal((await remove(saved.id, { confirmation: "YES" })).statusCode, 400);
  assert.equal((await remove("not-an-id")).statusCode, 404);
  assert.equal((await remove(randomUUID())).statusCode, 404);
  assert(await exists(archivePath(saved.id)));
  assert(await exists(jobPath(saved.id)));

  const operation = { ...keeper, id: randomUUID(), status: "running" };
  await acquireBackupLock(operation);
  assert.equal((await remove(saved.id)).statusCode, 409);
  await releaseBackupLock(operation.id);
  const active = await fixture({ status: "running" });
  assert.equal((await remove(active.id)).statusCode, 409);
  const restore = await fixture({ kind: "restore", status: "running", archiveId: saved.id });
  assert.equal((await remove(saved.id)).statusCode, 409);
  await updateJob(restore, { status: "restored" });
  assert.equal((await remove(restore.id)).statusCode, 409);

  await writeFile(`${archivePath(saved.id)}.partial`, Buffer.alloc(128));
  await writeFile(`${jobPath(saved.id)}.partial`, "partial");
  const deleted = await remove(saved.id);
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.headers["cache-control"], "no-store");
  assert.equal(deleted.json().freedBytes, 2048 + 128 + 7);
  for (const file of [archivePath(saved.id), `${archivePath(saved.id)}.partial`, jobPath(saved.id), `${jobPath(saved.id)}.partial`]) assert.equal(await exists(file), false);
  assert.equal((await app.inject({ url: `/api/admin/backups/${saved.id}/download`, headers })).statusCode, 404);
  assert.equal((await remove(saved.id)).statusCode, 404);
  assert.equal(await backupBusy(), false);
  assert.equal((await readFile(archivePath(keeper.id))).length, 2048);
  assert(await exists(jobPath(keeper.id)));
  assert(!(await app.inject({ url: "/api/admin/backups", headers })).json().jobs.some(job => job.id === saved.id));

  const failed = await fixture({ kind: "upload", status: "failed" });
  await rm(archivePath(failed.id));
  await writeFile(`${archivePath(failed.id)}.partial`, "incomplete");
  assert.equal((await remove(failed.id)).json().freedBytes, 10);
  assert.equal(await exists(`${archivePath(failed.id)}.partial`), false);
  assert.equal(await exists(jobPath(failed.id)), false);

  const broken = await fixture();
  await rm(archivePath(broken.id));
  await mkdir(archivePath(broken.id));
  assert.equal((await remove(broken.id)).statusCode, 500);
  assert(await exists(jobPath(broken.id)));
  assert.equal(await backupBusy(), false);
  await rmdir(archivePath(broken.id));
  assert.equal((await remove(broken.id)).statusCode, 200);

  for (let index = 0; index < 51; index++) await fixture();
  assert((await app.inject({ url: "/api/admin/backups", headers })).json().jobs.length > 50, "Older archives must remain visible for deletion.");
  console.log("PASS: signed sessions and portable installer; deletion requires confirmation, removes files and metadata, reports freed bytes, preserves other copies, blocks active/restore jobs, releases locks on errors, and lists older archives.");
} finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
