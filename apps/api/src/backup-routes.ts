import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { z } from "zod";
import { readAdminSession, readAdminSessionToken } from "./admin-auth.js";
import { command, acquireBackupLock, backupBusy, backupWorkerStarted, releaseBackupLock, appRoot, archivePath, backupRoot, createFullBackup, getJob, inspectFullBackup, jobPath, listJobs, MAX_ARCHIVE_BYTES, publicTargetUrl, updateJob, validateJobId, validatePassword, type BackupJob } from "./full-backup.js";

function adminOnly(request: FastifyRequest): boolean {
  const token = request.headers["x-admin-session"];
  return Boolean(readAdminSession(request.headers.cookie) || readAdminSessionToken(Array.isArray(token) ? token[0] : token));
}
function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Операция не завершена.";
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[адрес БД скрыт]").slice(0, 1200);
}
function newJob(kind: BackupJob["kind"]): BackupJob {
  return { id: randomUUID(), kind, status: "running", step: "Подготовка", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export async function registerBackupRoutes(app: FastifyInstance) {
  await app.register(async backupApp => {
    // Unlike legacy admin endpoints, full archives always require a signed admin session, including loopback requests.
    backupApp.addHook("onRequest", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!adminOnly(request)) return reply.code(401).send({ error: "Войдите в админ-панель." });
    });
    backupApp.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));
    backupApp.get("/api/admin/backups", async () => { const busy = await backupBusy(); return { jobs: await listJobs(), busy, restoreAvailable: process.platform === "linux" && process.getuid?.() === 0 }; });
    backupApp.get("/api/admin/backups/installer", async (_request, reply) => {
      const template = await readFile(join(appRoot, "deploy/scripts/restore-full-panel.sh"), "utf8");
      const module = (await readFile(join(appRoot, "apps/api/dist/full-backup.js"))).toString("base64");
      const helper = (await readFile(join(appRoot, "scripts/panel-backup-archive.py"))).toString("base64");
      return reply.type("application/x-sh").header("Content-Disposition", 'attachment; filename="restore-foxpoint.sh"').send(template.replace("__FOXPOINT_BACKUP_MODULE_BASE64__", module).replace("__FOXPOINT_ARCHIVE_HELPER_BASE64__", helper));
    });
    backupApp.post("/api/admin/backups", async (request, reply) => {
      const payload = z.object({ password: z.string().min(12).max(256) }).safeParse(request.body);
      if (!payload.success) return reply.code(400).send({ error: "Пароль архива: от 12 до 256 символов." });
      const job = newJob("create");
      try { await acquireBackupLock(job); } catch (error) { return reply.code(409).send({ error: errorMessage(error) }); }
      try { await updateJob(job, {}); } catch (error) { await releaseBackupLock(job.id); throw error; }
      void (async () => {
        try {
          const manifest = await createFullBackup({ password: payload.data.password, output: archivePath(job.id), progress: step => updateJob(job, { step }) });
          await updateJob(job, { status: "ready", step: "Полный бэкап готов", manifest, bytes: (await stat(archivePath(job.id))).size });
        } catch (error) { await updateJob(job, { status: "failed", step: "Не удалось создать бэкап", error: errorMessage(error) }); }
        finally { await releaseBackupLock(job.id); }
      })().catch(error => app.log.error({ err: errorMessage(error) }, "Backup operation failed"));
      return reply.code(202).send({ id: job.id });
    });
    backupApp.get<{ Params: { id: string } }>("/api/admin/backups/:id/download", async (request, reply) => {
      const job = await getJob(request.params.id).catch(() => null);
      if (!job || job.status !== "ready") return reply.code(404).send({ error: "Готовый архив не найден." });
      const file = archivePath(job.id);
      reply.header("Content-Disposition", `attachment; filename="foxpoint-full-${job.createdAt.slice(0, 10)}-${job.id.slice(0, 8)}.foxbackup"`);
      reply.header("Content-Length", (await stat(file)).size);
      return reply.type("application/octet-stream").send(createReadStream(file));
    });
    backupApp.post<{ Params: { id: string } }>("/api/admin/backups/:id/delete", async (request, reply) => {
      if (!z.object({ confirmation: z.literal("УДАЛИТЬ") }).safeParse(request.body).success) return reply.code(400).send({ error: "Подтвердите удаление архива." });
      const id = request.params.id;
      try { validateJobId(id); } catch { return reply.code(404).send({ error: "Архив не найден." }); }
      // A separate, unlisted operation owns the lock until both the archive and its record are removed.
      const operation = newJob("create");
      try { await acquireBackupLock(operation); } catch (error) { return reply.code(409).send({ error: errorMessage(error) }); }
      try {
        const saved = await getJob(id).catch(() => null);
        if (!saved || saved.id !== id) { reply.code(404); return { error: "Архив не найден." }; }
        if (saved.status === "running") { reply.code(409); return { error: "Нельзя удалить архив незавершённой операции." }; }
        if (saved.kind === "restore") { reply.code(409); return { error: "Это запись восстановления, а не сохранённый архив." }; }
        if ((await listJobs()).some(job => job.kind === "restore" && job.status === "running" && job.archiveId === id)) { reply.code(409); return { error: "Этот архив используется для восстановления. Дождитесь завершения." }; }
        let freedBytes = 0;
        // Only these exact files are deleted. Restore work directories and other backups are preserved.
        for (const file of [archivePath(id), `${archivePath(id)}.partial`, `${jobPath(id)}.partial`]) {
          const info = await lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
          await rm(file, { force: true });
          if (info?.isFile()) freedBytes += info.size;
        }
        await rm(jobPath(id));
        return { id, freedBytes };
      } catch (error) { reply.code(500); return { error: errorMessage(error) }; }
      finally { await releaseBackupLock(operation.id); }
    });
    backupApp.post("/api/admin/backups/upload", { bodyLimit: MAX_ARCHIVE_BYTES }, async (request, reply) => {
      const encodedPassword = request.headers["x-backup-password"];
      const password = typeof encodedPassword === "string" ? Buffer.from(encodedPassword, "base64").toString("utf8") : "";
      try { validatePassword(password); } catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
      if (!(request.body instanceof Readable)) return reply.code(400).send({ error: "Загрузите файл .foxbackup." });
      const job = newJob("upload");
      try { await acquireBackupLock(job); } catch (error) { return reply.code(409).send({ error: errorMessage(error) }); }
      const partial = `${archivePath(job.id)}.partial`;
      let temporary: string | undefined;
      let bytes = 0;
      try {
        await updateJob(job, { step: "Принимаем архив" });
        temporary = await mkdtemp(join(backupRoot, ".checking-"));
        const limit = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; done(bytes > MAX_ARCHIVE_BYTES ? new Error("Архив больше 20 ГБ.") : null, chunk); } });
        await pipeline(request.body, limit, createWriteStream(partial, { flags: "wx", mode: 0o600 }));
        await updateJob(job, { step: "Проверяем пароль и целостность" });
        const manifest = await inspectFullBackup({ archive: partial, password, destination: temporary });
        await rename(partial, archivePath(job.id));
        await updateJob(job, { status: "ready", step: "Архив проверен и готов к восстановлению", manifest, bytes });
        return { id: job.id, manifest };
      } catch (error) {
        await updateJob(job, { status: "failed", step: "Архив отклонён", error: errorMessage(error) });
        return reply.code(400).send({ error: errorMessage(error) });
      } finally { await releaseBackupLock(job.id); await rm(partial, { force: true }); if (temporary) await rm(temporary, { recursive: true, force: true }); }
    });
    backupApp.post<{ Params: { id: string } }>("/api/admin/backups/:id/restore", async (request, reply) => {
      const payload = z.object({ password: z.string().min(12).max(256), targetUrl: z.string().url(), confirmation: z.literal("ВОССТАНОВИТЬ") }).safeParse(request.body);
      if (!payload.success) return reply.code(400).send({ error: "Укажите пароль, адрес сайта и подтверждение ВОССТАНОВИТЬ." });
      if (process.platform !== "linux" || process.getuid?.() !== 0) return reply.code(400).send({ error: "Полное восстановление доступно на Linux VPS. Для нового сервера используйте установщик из раздела «Бэкап»." });
      let targetUrl: string;
      try { targetUrl = publicTargetUrl(payload.data.targetUrl); } catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
      const saved = await getJob(request.params.id).catch(() => null);
      if (!saved || saved.status !== "ready") return reply.code(404).send({ error: "Сначала загрузите и проверьте архив." });
      const job = newJob("restore");
      try { await acquireBackupLock(job); } catch (error) { return reply.code(409).send({ error: errorMessage(error) }); }
      // systemd keeps this worker alive while it replaces and restarts the API itself.
      const worker = join(backupRoot, `worker-${job.id}`);
      try {
        // Deletion may have finished between the initial lookup and acquiring the operation lock.
        const current = await getJob(saved.id).catch(() => null);
        const archiveExists = await stat(archivePath(saved.id)).then(info => info.isFile()).catch(() => false);
        if (!current || current.status !== "ready" || !archiveExists) {
          await releaseBackupLock(job.id);
          return reply.code(404).send({ error: "Выбранный архив уже удалён. Обновите список бэкапов." });
        }
        await updateJob(job, { archiveId: saved.id, targetUrl, step: "Подготовка к восстановлению" });
        await mkdir(worker, { recursive: true, mode: 0o700 });
        const { cp } = await import("node:fs/promises");
        await cp(join(appRoot, "apps/api/dist/full-backup.js"), join(worker, "full-backup.mjs"));
        await cp(join(appRoot, "scripts/restore-panel-worker.mjs"), join(worker, "worker.mjs"));
        await cp(join(appRoot, "scripts/panel-backup-archive.py"), join(worker, "archive.py"));
        await writeFile(join(worker, "request.json"), JSON.stringify({ archive: archivePath(saved.id), password: payload.data.password, targetUrl, root: appRoot, helper: join(worker, "archive.py"), workDirectory: join(worker, "work"), job }), { mode: 0o600 });
        const child = spawn("systemd-run", ["--quiet", "--collect", `--unit=foxpoint-restore-${job.id}`, "--property=Type=exec", "--setenv", `FOXPOINT_BACKUP_DIR=${backupRoot}`, "flock", "-n", "/var/lock/foxpoint-local-fix.lock", process.execPath, join(worker, "worker.mjs"), join(worker, "request.json")], { windowsHide: true, stdio: "ignore" });
        const code = await new Promise<number | null>((accept, reject) => { child.once("error", reject); child.once("exit", accept); }).catch(() => -1);
        let started = false;
        if (code === 0) for (let attempt = 0; attempt < 40; attempt++) {
          if (await backupWorkerStarted(job.id) || (await getJob(job.id)).status !== "running") { started = true; break; }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (!started) { await command("systemctl", ["stop", `foxpoint-restore-${job.id}`]).catch(() => undefined); throw new Error("Не удалось запустить служебное восстановление."); }
        return reply.code(202).send({ id: job.id, targetUrl });
      } catch (error) {
        await releaseBackupLock(job.id);
        await rm(join(worker, "request.json"), { force: true });
        await updateJob(job, { status: "failed", step: "Восстановление не запущено", error: errorMessage(error) });
        return reply.code(500).send({ error: job.error });
      }
    });
  });
}
