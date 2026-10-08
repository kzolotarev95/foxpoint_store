import { readFile, rm, rename, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
const requestFile = resolve(process.argv[2]);
const request = JSON.parse(await readFile(requestFile, "utf8"));
const { restoreFullBackup, updateJob, archivePath, takeOverBackupLock, releaseBackupLock } = await import(new URL("./full-backup.mjs", import.meta.url));
try {
  await takeOverBackupLock(request.job.id);
  await rm(requestFile, { force: true });
  await restoreFullBackup({ ...request, progress: step => updateJob(request.job, { step }), beforeBackup: async (manifest, file) => {
    const now = new Date().toISOString();
    const job = { id: randomUUID(), kind: "create", status: "ready", step: "Автоматическая полная копия перед восстановлением", createdAt: now, updatedAt: now, manifest, bytes: (await stat(file)).size };
    await rename(file, archivePath(job.id));
    await updateJob(job, {});
  } });
  await updateJob(request.job, { status: "restored", step: "Полная панель восстановлена" });
} catch (error) {
  await updateJob(request.job, { status: "failed", step: "Восстановление не завершено", error: error instanceof Error ? error.message : "Ошибка восстановления" });
  process.exitCode = 1;
} finally { await releaseBackupLock(request.job.id); }
