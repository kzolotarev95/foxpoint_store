import { mkdir, writeFile } from "node:fs/promises";
import { importReconciliation } from "../apps/api/dist/import-reconciliation.js";
import { prisma } from "../apps/api/dist/prisma.js";
try {
  const report = await importReconciliation();
  await mkdir(".codex-temp/reconciliation", { recursive: true });
  const file = `.codex-temp/reconciliation/report-${Date.now()}.json`;
  await writeFile(file, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ mode: "read-only", file, records: report.length, eligible: report.filter(r => r.eligible).length, manualReview: report.filter(r => !r.eligible && !r.completed).length }, null, 2));
} finally { await prisma.$disconnect(); }
