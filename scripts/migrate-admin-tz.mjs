// Additive migration of explicit legacy metadata; no payments, credentials or end dates change.
import { prisma } from "../apps/api/dist/prisma.js";
import { ensureClientAndRouterCodes } from "../apps/api/dist/client-codes.js";
import { readFile } from "node:fs/promises";
try {
  await ensureClientAndRouterCodes();
  const imported = await prisma.router.findMany({ where: { importKey: { startsWith: "client-register-v1:" } }, include: { owner: true } });
  const source = JSON.parse(await readFile("scripts/data/foxpoint-client-database.json", "utf8"));
  let archived = 0, test = 0;
  for (const router of imported) {
    const snapshot = router.importSnapshot ?? source.find(row => row.clientCode === router.owner.clientCode && row.routerName === router.displayName && row.name === router.owner.name);
    if (snapshot?.state === "Архив" && !router.owner.archivedAt) {
      // Explicit later admin edits take precedence over source metadata.
      const edits = await prisma.adminAuditLog.findMany({ where: { entityId: router.ownerUserId, action: "user_updated" }, select: { afterData: true } });
      if (!edits.some(edit => edit.afterData && Object.hasOwn(edit.afterData, "archivedAt"))) { await prisma.user.update({ where: { id: router.ownerUserId }, data: { archivedAt: router.createdAt } }); archived++; }
    }
    if (snapshot?.clientCode === "CLI-0001" && snapshot?.name === "Тестовый" && !router.owner.isTest) {
      const edits = await prisma.adminAuditLog.findMany({ where: { entityId: router.ownerUserId, action: "user_updated" }, select: { afterData: true } });
      if (!edits.some(edit => edit.afterData && Object.hasOwn(edit.afterData, "isTest"))) { await prisma.user.update({ where: { id: router.ownerUserId }, data: { isTest: true } }); test++; }
    }
  }
  console.log(JSON.stringify({ archived, test, changedFinancialRecords: 0 }));
} finally { await prisma.$disconnect(); }
