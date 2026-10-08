import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import Fastify from "fastify";

// Only fixtures in an explicitly selected, disposable database are changed.
if (!process.env.NOTIFICATIONS_TEST_DATABASE_URL) throw new Error("Set NOTIFICATIONS_TEST_DATABASE_URL to a disposable PostgreSQL database with the current schema.");
const database = new URL(process.env.NOTIFICATIONS_TEST_DATABASE_URL);
if (!database.pathname.includes("notifications_test")) throw new Error("The database name must contain notifications_test.");
process.env.DATABASE_URL = database.toString();
const { prisma } = await import("../apps/api/dist/prisma.js");
const auth = await import("../apps/api/dist/client-auth.js");
const portal = await import("../apps/api/dist/portal.js");
const notices = await import("../apps/api/dist/notifications.js");
const { registerNotificationRoutes } = await import("../apps/api/dist/notification-routes.js");
const app = Fastify();
await registerNotificationRoutes(app);
const { registerClientSupportRoutes } = await import("../apps/api/dist/client-support-routes.js");
await registerClientSupportRoutes(app);
const users = [];
const request = { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", "x-client-forwarded-for": "192.0.2.15" }, ip: "127.0.0.1", socket: {} };
try {
  const first = await auth.registerClientFromCredentials({ login: `notification-${randomUUID()}`, password: "fixture-only-password", request }); users.push(first.userId);
  const second = await auth.registerClientFromCredentials({ login: `notification-${randomUUID()}`, password: "fixture-only-password", request }); users.push(second.userId);
  const headers = { ...request.headers, "x-client-session": first.token };
  const call = async (path = "", payload, suppliedHeaders = headers) => app.inject({ method: payload ? "POST" : "GET", url: `/api/me/notifications${path}`, headers: suppliedHeaders, ...(payload ? { payload } : {}) });
  const feed = async () => { const res = await call(); assert.equal(res.statusCode, 200, res.body); assert.equal(res.headers["cache-control"], "no-store"); return res.json(); };
  for (const path of ["", "/read", "/clear"]) {
    const response = await call(path, path ? {} : undefined, {}); assert.equal(response.statusCode, 401);
    assert.equal((await call(path, path ? {} : undefined, { "x-client-session": "forged.session" })).statusCode, 401);
  }
  let data = await feed();
  assert.equal(data.unreadCount, 1); assert.equal(data.notifications[0].title, "Вход выполнен");
  assert.match(data.notifications[0].detail, /Chrome, Windows.*192\.0\.2\.15/);
  const loginId = data.notifications[0].id;
  await call("", undefined, { ...headers, "user-agent": "Firefox/140.0", "x-client-forwarded-for": "192.0.2.99" });
  data = await feed(); assert.equal(data.notifications.length, 1, "Activity must not become another login");
  assert.match(data.notifications[0].detail, /Chrome, Windows.*192\.0\.2\.15/, "Login detail is a snapshot");
  const ticket = await portal.createSupportTicketForUser({ userId: first.userId, category: "Test", description: "Local test request" });
  await portal.addAdminSupportTicketMessage({ ticketId: ticket.ticketId, body: "Первый ответ\nПерезагрузите роутер." });
  await portal.addAdminSupportTicketMessage({ ticketId: ticket.ticketId, body: "Второй ответ: проверили подключение." });
  await portal.addClientSupportTicketMessageForUser({ ticketId: ticket.ticketId, userId: first.userId, body: "Ответ клиента" });
  data = await feed(); assert.equal(data.unreadCount, 4);
  const replies = data.notifications.filter(item => item.type === "SUPPORT_REPLY");
  assert.equal(replies.length, 3); assert(replies.some(item => item.detail === "Первый ответ\nПерезагрузите роутер."));
  assert(replies.every(item => item.href === `/cabinet/support?ticket=${ticket.ticketId}#ticket-${ticket.ticketId}`));
  const detail = await app.inject({ url: `/api/me/tickets/${ticket.ticketId}`, headers });
  assert.equal(detail.statusCode, 200); assert(detail.json().messages.some(message => message.body === "Первый ответ\nПерезагрузите роутер."));
  assert.equal((await app.inject({ url: `/api/me/tickets/${ticket.ticketId}`, headers: { "x-client-session": second.token } })).statusCode, 404);
  assert.equal((await app.inject({ url: `/api/me/tickets/${ticket.ticketId}` })).statusCode, 401);

  const foreign = (await notices.getClientNotificationFeed(second.userId)).notifications[0];
  assert.equal((await call("/read", { notificationId: foreign.id })).json().updatedCount, 0);
  assert.equal((await notices.getClientNotificationFeed(second.userId)).unreadCount, 1);
  assert.equal((await call("/read", { notificationId: loginId })).json().updatedCount, 1);
  assert.equal((await feed()).unreadCount, 3);
  await portal.updateAdminTicket({ ticketId: ticket.ticketId, status: "WAITING_CLIENT" });
  await portal.updateAdminTicket({ ticketId: ticket.ticketId, status: "WAITING_CLIENT" });
  data = await feed(); assert.equal(data.notifications.filter(item => item.type === "SUPPORT_STATUS").length, 1);
  assert(data.notifications.some(item => item.detail === "Ожидаем ваш ответ"));
  const order = await prisma.routerOrder.create({ data: { userId: first.userId, routerPrice: 100, setupPrice: 0, totalPrice: 100 } });
  await portal.updateAdminOrder({ orderId: order.id, status: "SHIPPED", trackingNumber: "LOCAL-TRACK" });
  await portal.updateAdminOrder({ orderId: order.id, status: "SHIPPED", trackingNumber: "LOCAL-TRACK" });
  assert.equal((await feed()).notifications.filter(item => item.type === "ORDER_UPDATED").length, 1);
  const router = await prisma.router.create({ data: { ownerUserId: first.userId, displayName: "Fixture router" } });
  const subscription = await prisma.subscription.create({ data: { routerId: router.id, priceSnapshot: 100 } });
  const payment = { subscriptionId: subscription.id, amount: 100, days: 30, requestKey: randomUUID() };
  await portal.addAdminSubscriptionPayment(payment); await portal.addAdminSubscriptionPayment(payment);
  assert.equal((await feed()).notifications.filter(item => item.type === "PAYMENT_PAID").length, 1, "Repeated payment must not notify twice");
  for (const [key, value] of [["platega_merchant_id", "local-fixture-merchant"], ["platega_secret", "local-fixture-secret"]]) {
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  const providerPaymentId = randomUUID();
  await prisma.payment.create({ data: { userId: first.userId, provider: "platega", providerPaymentId, amount: 200, status: "PENDING" } });
  const callback = { amount: 200, merchantIdHeader: "local-fixture-merchant", secretHeader: "local-fixture-secret", providerPaymentId, status: "CONFIRMED" };
  await portal.handlePlategaCallback(callback); await portal.handlePlategaCallback(callback);
  assert.equal((await feed()).notifications.filter(item => item.type === "PAYMENT_PAID").length, 2, "Provider retries must not duplicate notifications");
  data = await feed(); const oldCutoff = data.asOf;
  await delay(5);
  await portal.addAdminSupportTicketMessage({ ticketId: ticket.ticketId, body: "Ответ, пришедший после открытия списка" });
  await call("/read", { before: oldCutoff });
  data = await feed(); assert.equal(data.unreadCount, 1, "Read all must preserve a newer event");
  await call("/clear", { before: oldCutoff });
  data = await feed(); assert.equal(data.notifications.length, 1); assert.equal(data.unreadCount, 1);
  assert.equal((await call("/clear", { before: "invalid" })).statusCode, 400);
  assert.equal((await call("/clear", { before: new Date(Date.now() + 86400000).toISOString() })).statusCode, 400);
  await call("/clear", { before: data.asOf });
  assert.equal((await feed()).notifications.length, 0); assert.equal((await feed()).unreadCount, 0);
  const restartedFeed = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `const {getClientNotificationFeed}=await import('./apps/api/dist/notifications.js'); const {prisma}=await import('./apps/api/dist/prisma.js'); console.log(JSON.stringify(await getClientNotificationFeed(${JSON.stringify(first.userId)}))); await prisma.$disconnect();`], { encoding: "utf8", env: process.env }));
  assert.equal(restartedFeed.notifications.length, 0, "Cleared events must stay hidden after restart and history backfill");
  assert(await prisma.notification.count({ where: { userId: first.userId } }) > 0, "Clearing must not remove underlying history or chats");
  // Backfill uses actual creation dates and respects previously cleared/read history.
  const legacy = await prisma.user.create({ data: { name: "Notification migration fixture", notificationFeedClearedAt: new Date(Date.now() - 10000), notificationFeedSeenAt: new Date(Date.now() - 5000) } }); users.push(legacy.id);
  await prisma.clientSession.create({ data: { userId: legacy.id, createdAt: new Date(Date.now() - 20000), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 86400000) } });
  const legacyTicket = await prisma.supportTicket.create({ data: { userId: legacy.id, category: "Test", description: "History" } });
  await prisma.supportTicketMessage.create({ data: { ticketId: legacyTicket.id, authorRole: "ADMIN", body: "Старое очищенное сообщение", createdAt: new Date(Date.now() - 20000) } });
  await prisma.supportTicketMessage.create({ data: { ticketId: legacyTicket.id, authorRole: "ADMIN", body: "Уже прочитанное сообщение", createdAt: new Date(Date.now() - 7000) } });
  await prisma.supportTicketMessage.create({ data: { ticketId: legacyTicket.id, authorRole: "ADMIN", body: "Новое сообщение" } });
  const migrated = await notices.getClientNotificationFeed(legacy.id);
  assert.equal(migrated.notifications.length, 2); assert.equal(migrated.unreadCount, 1);
  assert.equal((await notices.getClientNotificationFeed(legacy.id)).notifications.length, 2, "Backfill is idempotent");
  const oldCommentsUser = await prisma.user.create({ data: { name: "Legacy support comment fixture" } }); users.push(oldCommentsUser.id);
  await prisma.supportTicket.create({ data: { userId: oldCommentsUser.id, category: "Test", description: "Old request", adminComment: "Ответ из старой версии поддержки" } });
  assert.equal((await notices.getClientNotificationFeed(oldCommentsUser.id)).notifications[0].detail, "Ответ из старой версии поддержки");
  // More than one screen of events: counts/actions cover every record, not just the visible 50.
  await prisma.$transaction(async tx => { for (let i = 0; i < 55; i++) await notices.createClientNotification(tx, { userId: first.userId, type: "TEST", title: `Событие ${i}`, detail: "Fixture", href: "/cabinet/profile" }); });
  data = await feed(); assert.equal(data.notifications.length, 50); assert.equal(data.unreadCount, 55); assert.equal(data.hasMore, true);
  await call("/read", { before: data.asOf }); assert.equal((await feed()).unreadCount, 0);
  data = await feed(); await call("/clear", { before: data.asOf }); assert.equal((await feed()).notifications.length, 0);
  // Concurrent writers also acquire foreign-key locks: avoid lock-upgrade deadlocks.
  await Promise.all(Array.from({ length: 5 }, () => portal.addAdminSupportTicketMessage({ ticketId: ticket.ticketId, body: "Одновременный ответ" })));
  assert.equal((await feed()).unreadCount, 5);
  const session = auth.readClientSessionToken(first.token);
  await auth.revokeClientSessionForUser({ userId: first.userId, sessionId: session.sid });
  await auth.revokeClientSessionForUser({ userId: first.userId, sessionId: session.sid });
  assert.equal((await call()).statusCode, 401);
  assert.equal(await prisma.notification.count({ where: { userId: first.userId, type: "SESSION_REVOKED" } }), 1);
  console.log("PASS: real login/support/payment/order events; exact text and links; history migration; isolation; read/clear races; >50 events; concurrent writers; revoked sessions.");
} finally {
  await app.close();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.appSetting.deleteMany({ where: { key: { in: ["platega_merchant_id", "platega_secret"] }, value: { in: ["local-fixture-merchant", "local-fixture-secret"] } } });
  await prisma.$disconnect();
}
