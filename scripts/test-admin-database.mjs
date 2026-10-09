import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const target = process.env.ADMIN_TEST_DATABASE_URL;
if (!target || !new URL(target).pathname.includes("admin_test") || new URL(target).hostname !== "127.0.0.1") throw new Error("Select a disposable local admin_test database.");
process.env.DATABASE_URL = target;
const { prisma } = await import("../apps/api/dist/prisma.js");
const portal = await import("../apps/api/dist/portal.js");
const auth = await import("../apps/api/dist/client-auth.js");
const { buildAdminDatabase } = await import("../apps/api/dist/admin-database.js");
const { ensureClientAndRouterCodes } = await import("../apps/api/dist/client-codes.js");
const { importClientDatabase } = await import("../apps/api/dist/client-database-import.js");
const { applyImportCorrection, importReconciliation } = await import("../apps/api/dist/import-reconciliation.js");
const { exportDatabase } = await import("../apps/api/dist/database-export.js");
const day = 86400000, prefix = `admintest-${randomUUID()}`, users = [];
async function customer(data = {}) { const user = await prisma.user.create({ data: { name: prefix, status: "ACTIVE", ...data } }); users.push(user.id); return user; }
async function device(user, data = {}, subscription = {}) {
  return prisma.router.create({ data: { ownerUserId: user.id, displayName: "SPB-fixture", status: "ACTIVE", configurationType: "EXTENDED", serviceTariff: "Сервер", ...data,
    template: { create: { accessEnabled: true, currentPrice: 1000, priceOverride: 1000 } },
    subscriptions: { create: { accessEnabled: true, status: "ACTIVE", priceSnapshot: 1000, startAt: new Date(), endAt: new Date(Date.now() + 5 * day), ...subscription } } }, include: { subscriptions: true } });
}
try {
  const first = await customer({ clientCode: "CLI-9010", city: "Самара", phone: "+7 (900) 111-22-33" });
  const r = await device(first, { routerCode: first.clientCode, adminNote: "private-IP-secret" });
  const sub = r.subscriptions[0], originalEnd = sub.endAt.getTime();
  const pay = { subscriptionId: sub.id, amount: 1000, days: 30, requestKey: randomUUID() };
  await Promise.all([portal.addAdminSubscriptionPayment(pay), portal.addAdminSubscriptionPayment(pay)]);
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).endAt.getTime(), originalEnd + 30 * day, "repeat must add 30 once, retaining 5 days");
  await assert.rejects(portal.addAdminSubscriptionPayment({ ...pay, amount: 2000 }), /Ключ/);
  await Promise.all([1, 2].map(() => portal.addAdminSubscriptionPayment({ ...pay, requestKey: randomUUID() })));
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).endAt.getTime(), originalEnd + 90 * day, "distinct concurrent payments add 60");
  assert.equal(await prisma.payment.count({ where: { routerId: r.id } }), 3);
  const second = await device(first, { routerCode: "CLI-9010/02" });
  await ensureClientAndRouterCodes();
  const coded = await prisma.router.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal(coded.routerCode, "CLI-9010/01"); assert(coded.codeAliases.includes("CLI-9010"));
  assert.equal((await prisma.router.findUniqueOrThrow({ where: { id: second.id } })).routerCode, "CLI-9010/02");
  const oldQr = await portal.createPublicSupportTicket({ routerCode: "CLI-9010", description: "Проверка старого QR на тестовой БД", contact: "fixture" });
  assert.equal((await prisma.supportTicket.findUniqueOrThrow({ where: { number: oldQr.number } })).routerId, r.id);
  const clientOverview = await portal.buildClientOverview({ userId: first.id });
  assert(!JSON.stringify(clientOverview).includes("private-IP-secret"), "admin note must stay private");
  await auth.upsertLocalCredentialsForUser({ userId: first.id, login: `fixture-${randomUUID()}`, password: "fixture-password", adminUpdate: true });
  const identity = await prisma.authIdentity.findFirstOrThrow({ where: { userId: first.id, provider: "LOCAL" } });
  await auth.upsertLocalCredentialsForUser({ userId: first.id, login: `fixture-${randomUUID()}`, adminUpdate: true });
  assert.equal((await prisma.authIdentity.findUniqueOrThrow({ where: { id: identity.id } })).passwordHash, identity.passwordHash);
  const pendingUser = await customer();
  const otherOverview = await portal.buildClientOverview({ userId: pendingUser.id });
  assert(!otherOverview.routers.some(router => router.id === r.id));
  await assert.rejects(portal.createSupportTicketForUser({ userId: pendingUser.id, routerId: r.id, category: "Test", description: "Чужой роутер" }), /не принадлежит/);
  const pendingRouter = await device(pendingUser, { configurationType: "BASIC" }, { status: "DRAFT", pendingActivation: true, startAt: null, endAt: null });
  const pendingId = pendingRouter.subscriptions[0].id;
  await portal.addAdminSubscriptionPayment({ ...pay, subscriptionId: pendingId, requestKey: randomUUID() });
  await portal.addAdminSubscriptionPayment({ ...pay, subscriptionId: pendingId, requestKey: randomUUID() });
  let held = await prisma.subscription.findUniqueOrThrow({ where: { id: pendingId } });
  assert.equal(held.pendingDays, 60); assert.equal(held.endAt, null); assert.equal(held.startAt, null);
  await portal.updateAdminSubscription({ subscriptionId: pendingId, pendingActivation: false, status: "ACTIVE" });
  held = await prisma.subscription.findUniqueOrThrow({ where: { id: pendingId } });
  assert.equal(held.endAt - held.startAt, 60 * day); assert.equal(held.pendingDays, 0);
  const minute = date => new Date(Math.floor(date.getTime() / 60000) * 60000).toISOString();
  await portal.updateAdminSubscription({ subscriptionId: pendingId, pendingActivation: false, status: "ACTIVE", startAt: minute(held.startAt), endAt: minute(held.endAt) });
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: pendingId } })).endAt.getTime(), held.endAt.getTime(), "saving a minute-resolution form retains original seconds");
  const trialUser = await customer();
  const assignment = { userId: trialUser.id, displayName: "Trial fixture", configurationType: "BASIC", accessEnabled: true, supportType: "NONE", startTrial: true };
  await assert.rejects(portal.createAdminRouterAssignment(assignment), /полученного/);
  await prisma.routerOrder.create({ data: { userId: trialUser.id, routerPrice: 100, setupPrice: 0, totalPrice: 100, status: "RECEIVED", receivedAt: new Date() } });
  const trialRouter = await portal.createAdminRouterAssignment(assignment);
  const trialSub = await prisma.subscription.findFirstOrThrow({ where: { routerId: trialRouter.routerId } });
  assert.equal(trialSub.pendingDays, 14); assert.equal(trialSub.endAt, null);
  await portal.updateAdminSubscription({ subscriptionId: trialSub.id, pendingActivation: false, status: "ACTIVE" });
  const started = await prisma.subscription.findUniqueOrThrow({ where: { id: trialSub.id } });
  assert.equal(started.endAt - started.startAt, 14 * day);
  await portal.addAdminSubscriptionPayment({ ...pay, subscriptionId: started.id, requestKey: randomUUID() });
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: started.id } })).endAt - started.startAt, 44 * day);
  await assert.rejects(portal.createAdminRouterAssignment(assignment), /полученного/);
  const draft = await portal.createAdminRouterAssignment({ ...assignment, startTrial: false });
  assert.equal((await prisma.subscription.findFirstOrThrow({ where: { routerId: draft.routerId } })).endAt, null);
  assert.equal((await prisma.subscription.findFirstOrThrow({ where: { routerId: draft.routerId } })).pendingDays, 0, "unpaid assignment grants no free days");
  await prisma.subscriptionTemplate.update({ where: { routerId: r.id }, data: { currentPrice: 1700, priceOverride: 1700 } });
  // Forecast has two starts in a 31-day month and uses the saved next price.
  const y = new Date().getUTCFullYear() + 1;
  await prisma.subscription.update({ where: { id: sub.id }, data: { endAt: new Date(`${y}-01-01T00:00:00+03:00`) } });
  await prisma.payment.create({ data: { userId: first.id, routerId: r.id, amount: 99999, provider: "client_register_import", status: "PAID", paidAt: new Date() } });
  const dashboard = await buildAdminDatabase({ month: `${y-1}-12` });
  assert.equal(dashboard.dashboard.forecastDetails.filter(p => p.routerId === r.id).length, 2);
  assert.equal(dashboard.dashboard.forecastDetails.filter(p => p.routerId === r.id).reduce((a, p) => a + p.amount, 0), 3400);
  const current = await buildAdminDatabase({ q: "9001112233" });
  assert.equal(current.clientCount, 1); assert.equal(current.dashboard.confirmedPayments, 6000, "imports and draft periods cannot inflate money");
  await portal.deleteAdminRouter({ routerId: r.id });
  assert.equal(await prisma.payment.count({ where: { routerId: r.id } }), 4, "archive preserves money history");
  const archivedRouter = await prisma.router.findUniqueOrThrow({ where: { id: r.id } });
  assert(archivedRouter.archivedAt); assert.equal(archivedRouter.status, "ACTIVE", "archive is independent of technical state");
  // Provider notifications target the purchased service, including concurrent callbacks and refund retries.
  for (const [key, value] of [["platega_merchant_id", "admin-fixture"], ["platega_secret", "admin-fixture-secret"]]) await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const providerUser = await customer(); const providerRouter = await device(providerUser);
  const support = await prisma.subscription.create({ data: { routerId: providerRouter.id, supportType: "BASIC", priceSnapshot: 1000, status: "ACTIVE", startAt: new Date(), endAt: new Date(Date.now() + 10 * day) } });
  const supportEnd = support.endAt.getTime(), service = providerRouter.subscriptions[0], serviceEnd = service.endAt.getTime();
  const callbacks = [];
  for (let i = 0; i < 2; i++) {
    const providerPaymentId = randomUUID();
    await prisma.payment.create({ data: { userId: providerUser.id, routerId: providerRouter.id, provider: "platega", providerPaymentId, amount: 1000, daysAdded: 30, status: "PENDING", payloadSnapshot: { accessEnabled: true, supportType: "NONE", periodPrice: 1000, type: "subscription_renewal" } } });
    callbacks.push({ providerPaymentId, amount: 1000, merchantIdHeader: "admin-fixture", secretHeader: "admin-fixture-secret", status: "CONFIRMED" });
  }
  await Promise.all(callbacks.flatMap(callback => [portal.handlePlategaCallback(callback), portal.handlePlategaCallback(callback)]));
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: service.id } })).endAt.getTime(), serviceEnd + 60 * day);
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: support.id } })).endAt.getTime(), supportEnd, "server payment cannot extend support");
  await Promise.all([1, 2].map(() => portal.handlePlategaCallback({ ...callbacks[0], status: "CHARGEBACKED" })));
  const refunded = await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId: callbacks[0].providerPaymentId } });
  await portal.handlePlategaCallback({ ...callbacks[0], status: "CHARGEBACKED" });
  await portal.handlePlategaCallback(callbacks[0]);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: refunded.id } })).status, "REFUNDED");
  const finance = await buildAdminDatabase();
  assert.equal(finance.dashboard.refunds, 1000); assert.equal(finance.dashboard.confirmedPayments, 8000, "gross receipts and refunds stay separate");
  const ambiguousProviderId = randomUUID();
  await prisma.payment.create({ data: { userId: providerUser.id, routerId: providerRouter.id, provider: "platega", providerPaymentId: ambiguousProviderId, amount: 2000, status: "PENDING" } });
  const previousServiceEnd = (await prisma.subscription.findUniqueOrThrow({ where: { id: service.id } })).endAt.getTime();
  await portal.handlePlategaCallback({ ...callbacks[0], providerPaymentId: ambiguousProviderId, amount: 2000 });
  const ambiguous = await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId: ambiguousProviderId } });
  assert.equal(ambiguous.status, "PAID"); assert(ambiguous.payloadSnapshot.allocationNeeded);
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: service.id } })).endAt.getTime(), previousServiceEnd);
  const importedRows = [{ clientCode: "CLI-0019", name: prefix, phone: null, telegram: null, city: null, routerName: "SPB-16", tariff: "Сервер", state: "Активен", monthlyPrice: 1000, startDate: "2026-09-01", paidMonths: 1, paidAmount: 1000, note: null }];
  await importClientDatabase(importedRows); const impUser = await prisma.user.findUniqueOrThrow({ where: { clientCode: "CLI-0019" } }); users.push(impUser.id);
  const imp = await prisma.router.findFirstOrThrow({ where: { ownerUserId: impUser.id }, include: { subscriptions: true } });
  const verifiedSource={documentId:"1cDyIEme29pBPeogM4XlGFy3Q-YGZydBa",sha256:"a".repeat(64),verifiedAt:new Date().toISOString()};
  assert.equal((await importReconciliation()).find(r=>r.routerId===imp.id).eligible,false);
  await assert.rejects(applyImportCorrection(imp.id,"Нет проверенного источника"),/сверка/);
  await applyImportCorrection(imp.id, "Тест сверки документа", verifiedSource);
  assert((await applyImportCorrection(imp.id, "Тест повторного запроса", verifiedSource)).repeated);
  const corrected = await prisma.subscription.findFirstOrThrow({ where: { routerId: imp.id } });
  assert.equal(corrected.endAt - corrected.startAt, 60 * day);
  await portal.addAdminSubscriptionPayment({ ...pay, subscriptionId: corrected.id, requestKey: randomUUID() });
  const endBefore = (await prisma.subscription.findUniqueOrThrow({ where: { id: corrected.id } })).endAt.getTime();
  await importClientDatabase(importedRows);
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: corrected.id } })).endAt.getTime(), endBefore);
  for (const row of [
    { ...importedRows[0], clientCode: "CLI-0008", routerName: "SPB-06", tariff: "Индивидуальный", monthlyPrice: 500, paidAmount: 500 },
    { ...importedRows[0], clientCode: "CLI-0020", routerName: "SPB-17" },
    { ...importedRows[0], clientCode: "CLI-0004", routerName: "KZN-01", startDate: "2026-08-13", paidMonths: 2, paidAmount: 2000 }
  ]) {
    await importClientDatabase([row]); const customer = await prisma.user.findUniqueOrThrow({ where: { clientCode: row.clientCode } }); users.push(customer.id);
    const importedRouter = await prisma.router.findFirstOrThrow({ where: { ownerUserId: customer.id }, include: { subscriptions: true } });
    if (row.clientCode === "CLI-0020") {
      await portal.addAdminSubscriptionPayment({ ...pay, subscriptionId: importedRouter.subscriptions[0].id, requestKey: randomUUID() });
      assert.equal((await importReconciliation()).find(item => item.routerId === importedRouter.id).eligible, false);
      await assert.rejects(applyImportCorrection(importedRouter.id, "Проверка последующей оплаты", verifiedSource), /последующие оплаты/);
    } else {
      await applyImportCorrection(importedRouter.id, "Сверка исходных значений в тесте", verifiedSource);
      const correctedTerm = await prisma.subscription.findFirstOrThrow({ where: { routerId: importedRouter.id } });
      if (row.clientCode === "CLI-0008") {
        assert.equal(correctedTerm.endAt - correctedTerm.startAt, 60 * day);
        assert.equal(Number((await prisma.payment.findFirstOrThrow({ where: { routerId: importedRouter.id } })).amount), 1200);
      } else assert.equal(correctedTerm.endAt.toISOString(), "2026-10-12T20:00:00.000Z");
    }
  }
  const thousand = Array.from({ length: 1000 }, (_, i) => ({ id: `admintest-${prefix}-${i}`, name: `Масштаб ${String(i).padStart(4, "0")}`, city: "Казань" }));
  await prisma.user.createMany({ data: thousand }); users.push(...thousand.map(u => u.id));
  const start = performance.now();
  const large = await buildAdminDatabase({ q: "Масштаб", page: 10, pageSize: 100, sort: "name" });
  assert.equal(large.clientCount, 1000); assert.equal(large.clients.length, 100); assert.equal(large.clients[0].name, "Масштаб 0900");
  const all = await buildAdminDatabase({ q: "Масштаб", pageSize: 25 }, true);
  assert.equal(all.clients.length, 1000); assert.equal(large.dashboard.totalClients, all.dashboard.totalClients);
  const adminOverview = await portal.buildAdminOverview({ q: "Масштаб", pageSize: 100 });
  assert.equal(adminOverview.clientCount, 1000); assert.equal(adminOverview.clients.length, 100);
  await mkdir(".codex-temp/admin-test", { recursive: true });
  await writeFile(".codex-temp/admin-test/export.xlsx", exportDatabase(all, "xlsx").body);
  console.log(`PASS: exact/concurrent/idempotent periods; pending activation; eligible trial; credential preservation; QR aliases; private notes; finance; two January renewals; import replay; archive history; 1000 clients (${Math.round(performance.now() - start)} ms for list + export data).`);
} finally {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}
