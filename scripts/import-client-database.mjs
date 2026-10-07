import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(process.argv.find((arg) => arg.endsWith(".json")) ?? "scripts/data/foxpoint-client-database.json");
const { validateClientDatabase, getImportPlan, importClientDatabase } = await import("../apps/api/dist/client-database-import.js");
const { prisma } = await import("../apps/api/dist/prisma.js");
try {
  const rows = validateClientDatabase(JSON.parse(await readFile(source, "utf8")));
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ clients: new Set(rows.map((row) => row.clientCode)).size, routers: rows.length,
      paidDays: rows.reduce((sum, row) => sum + getImportPlan(row).daysAdded, 0) }, null, 2));
  } else {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL не задан. Укажите локальную БД.");
    const backupDir = resolve(".codex-temp/backups");
    await mkdir(backupDir, { recursive: true });
    const snapshot = await prisma.$transaction(async (tx) => ({
      users: await tx.user.findMany(), routers: await tx.router.findMany(),
      templates: await tx.subscriptionTemplate.findMany(), subscriptions: await tx.subscription.findMany(),
      payments: await tx.payment.findMany()
    }));
    const backup = resolve(backupDir, `before-client-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(backup, JSON.stringify(snapshot, null, 2), { flag: "wx" });
    console.log(`Снимок данных до импорта: ${backup}`);
    console.log(JSON.stringify(await importClientDatabase(rows), null, 2));
  }
} finally {
  await prisma.$disconnect();
}
