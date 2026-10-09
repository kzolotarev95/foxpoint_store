import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { DAY_MS } from "./subscription-period.js";
import { config } from "./config.js";

const corrections = [
  { code: "CLI-0008", object: "SPB-06", oldPlan: "Индивидуальный", oldPrice: 500, oldAmount: 500, plan: "Индивидуальный", price: 600, amount: 1200, days: 60 },
  { code: "CLI-0019", object: "SPB-16", oldPlan: "Сервер", oldPrice: 1000, oldAmount: 1000, plan: "Полный", price: 2000, amount: 4000, days: 60 },
  { code: "CLI-0020", object: "SPB-17", oldPlan: "Сервер", oldPrice: 1000, oldAmount: 1000, plan: "Полный", price: 2000, amount: 4000, days: 60 }
];
const historicEnds: Record<string, string> = {
  "CLI-0004": "2026-10-13", "CLI-0005": "2027-02-15", "CLI-0006": "2026-10-16", "CLI-0007": "2026-10-16", "CLI-0009": "2026-10-20", "CLI-0012": "2027-02-01",
  "CLI-0014": "2026-11-01", "CLI-0015": "2027-09-03", "CLI-0018": "2027-09-08", "CLI-0023": "2026-11-17", "CLI-0025": "2027-09-30"
};
export async function importReconciliation() {
  const records = await prisma.router.findMany({ where: { importKey: { startsWith: "client-register-v1:" } }, include: { owner: true, template: true, subscriptions: true, payments: true } });
  return records.filter(r => corrections.some(c => c.code === r.owner.clientCode) || historicEnds[r.owner.clientCode ?? ""]).map(r => {
    const desired = corrections.find(c => c.code === r.owner.clientCode && c.object === r.displayName);
    const payment = r.payments.find(p => p.provider === "client_register_import");
    const s = r.subscriptions.find(s => s.lastPaymentId === payment?.id);
    const completed = !!(r.importSnapshot as { reconciliationVersion?: string } | null)?.reconciliationVersion;
    const hasLaterPayment = r.payments.some(p => p.provider !== "client_register_import" && ["PAID", "REFUNDED"].includes(p.status));
    const baselineEnd = payment?.paidAt && payment.daysAdded ? payment.paidAt.getTime() + payment.daysAdded * DAY_MS : null;
    const untouchedTerm = !!baselineEnd && s?.endAt?.getTime() === baselineEnd && s.startAt?.getTime() === payment?.paidAt?.getTime();
    const eligible = !completed && !hasLaterPayment && untouchedTerm && !!payment && !!s && !!r.template && (desired ?
      r.serviceTariff === desired.oldPlan && Number(r.template.currentPrice) === desired.oldPrice && Number(payment.amount) === desired.oldAmount && payment.daysAdded === 30 : true);
    const expectedEnd = desired && payment?.paidAt ? new Date(payment.paidAt.getTime() + desired.days * DAY_MS) : historicEnds[r.owner.clientCode ?? ""] ? new Date(`${historicEnds[r.owner.clientCode ?? ""]}T00:00:00+04:00`) : null;
    return { routerId: r.id, code: r.owner.clientCode, object: r.displayName,
      currentPlan: r.serviceTariff, expectedPlan: desired?.plan ?? r.serviceTariff,
      currentPrice: Number(r.template?.currentPrice ?? 0), expectedPrice: desired?.price ?? Number(r.template?.currentPrice ?? 0),
      importedAmount: Number(payment?.amount ?? 0), expectedAmount: desired?.amount ?? Number(payment?.amount ?? 0),
      currentEnd: s?.endAt?.toISOString() ?? null, expectedEnd: expectedEnd?.toISOString() ?? null,
      eligible: false, baselineEligible: eligible, completed, state: completed ? "Исправлено" : "Ожидает сверки актуального источника Google Диска; применение заблокировано",
      source: desired ? "PDF: единое ТЗ от 08.10.2026, стр. 8" : "Историческое окончание Excel, столбец M" };
  });
}

export async function applyImportCorrection(routerId: string, reason: string, verifiedSource?: {documentId:string;sha256:string;verifiedAt:string}) {
  if (reason.trim().length < 8) throw new Error("Укажите причину корректировки.");
  if(verifiedSource?.documentId!=="1cDyIEme29pBPeogM4XlGFy3Q-YGZydBa" || !/^[a-f0-9]{64}$/.test(verifiedSource.sha256) || !Number.isFinite(Date.parse(verifiedSource.verifiedAt)))throw new Error("Сначала требуется сверка актуального файла Google Диска с сохранением контрольной суммы. Предпросмотр из прежних документов не разрешает применение.");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Router" WHERE "id" = ${routerId} FOR UPDATE`;
    const router = await tx.router.findUniqueOrThrow({ where: { id: routerId }, include: { owner: true, template: true, subscriptions: true, payments: true } });
    const code = router.owner.clientCode ?? "";
    const c = corrections.find(c => c.code === code && c.object === router.displayName);
    const historic = historicEnds[code];
    if (!c && !historic) throw new Error("Нет согласованной корректировки для этого объекта.");
    const snapshot = router.importSnapshot as Record<string, unknown> | null;
    if (snapshot?.reconciliationVersion) return { repeated: true };
    if (router.payments.some(p => p.provider !== "client_register_import" && ["PAID", "REFUNDED"].includes(p.status))) throw new Error("Обнаружены последующие оплаты. Автоматическая корректировка запрещена: сроки сохраняются.");
    const payment = router.payments.find(p => p.provider === "client_register_import");
    const subscription = router.subscriptions.find(s => s.lastPaymentId === payment?.id);
    if (!payment || !subscription || !router.template || !payment.paidAt) throw new Error("Не найдена исходная связка импорта.");
    if (subscription.endAt?.getTime() !== payment.paidAt.getTime() + (payment.daysAdded ?? 0) * DAY_MS || subscription.startAt?.getTime() !== payment.paidAt.getTime()) throw new Error("Исходный срок уже изменён. Автоматическая корректировка запрещена.");
    if (c && (router.serviceTariff !== c.oldPlan || Number(payment.amount) !== c.oldAmount || payment.daysAdded !== 30 || Number(router.template.currentPrice) !== c.oldPrice)) throw new Error("Запись уже изменена. Проверьте историю вручную.");
    const nextEnd = c ? new Date(payment.paidAt.getTime() + c.days * DAY_MS) : new Date(`${historic}T00:00:00+04:00`);
    if (!c && subscription.endAt && nextEnd < subscription.endAt) throw new Error("Корректировка не может уменьшить сохранённый срок.");
    const before = { router: { tariff: router.serviceTariff, importSnapshot: router.importSnapshot }, template: router.template, subscription, payment };
    const after = { plan: c?.plan ?? router.serviceTariff, price: c?.price ?? Number(router.template.currentPrice), amount: c?.amount ?? Number(payment.amount), days: c?.days ?? payment.daysAdded, endAt: nextEnd.toISOString(), reason, verifiedSource, source: c ? "PDF 08.10.2026 / стр. 8, сверено с актуальной базой" : "Историческое окончание, сверено с актуальной базой" };
    await tx.router.update({ where: { id: router.id }, data: { serviceTariff: after.plan, importSnapshot: { ...snapshot, reconciliationVersion: "admin-tz-20261008", originalSnapshot: snapshot, correction: after } as Prisma.InputJsonValue } });
    if (c) {
      await tx.subscriptionTemplate.update({ where: { routerId }, data: { currentPrice: c.price, priceOverride: c.price, accessEnabled: c.plan === "Полный", supportType: "BASIC" } });
      await tx.payment.update({ where: { id: payment.id }, data: { amount: c.amount, daysAdded: c.days, payloadSnapshot: { ...(payment.payloadSnapshot as object), sourceCorrection: after } as Prisma.InputJsonValue } });
    }
    await tx.subscription.update({ where: { id: subscription.id }, data: { endAt: nextEnd, priceSnapshot: after.price, ...(c ? { accessEnabled: c.plan === "Полный", supportType: "BASIC" } : {}) } });
    const adminEmail = `admin+${config.ADMIN_USERNAME}@foxpoint.local`;
    const admin = await tx.authIdentity.upsert({ where: { provider_providerUserId: { provider: "EMAIL", providerUserId: adminEmail } }, create: { provider: "EMAIL", providerUserId: adminEmail, email: adminEmail, user: { create: { name: `Admin ${config.ADMIN_USERNAME}` } } }, update: {} });
    await tx.adminAuditLog.create({ data: { adminId: admin.userId, entityType: "Router", entityId: routerId, action: "import_corrected", beforeData: JSON.parse(JSON.stringify(before)), afterData: after } });
    return { repeated: false, ...after };
  });
}
