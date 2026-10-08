import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type NoticeData = { userId: string; type: string; relatedType?: string; relatedId?: string; title: string; detail: string; href: string; createdAt?: Date };
export type ClientNotification = { id: string; type: string; title: string; detail: string; href: string; createdAt: string; readAt: string | null };

export function loginDescription(userAgent: string | null, ipAddress: string | null) {
  const agent = userAgent ?? "";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Браузер";
  const device = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Windows/.test(agent) ? "Windows" : /Macintosh/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "устройство";
  return `Вход в личный кабинет · ${browser}, ${device}${ipAddress ? ` · IP ${ipAddress}` : ""}.`;
}

export async function createClientNotification(tx: Prisma.TransactionClient, input: NoticeData) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR NO KEY UPDATE`;
  return tx.notification.create({ data: {
    userId: input.userId, type: input.type, relatedType: input.relatedType, relatedId: input.relatedId,
    createdAt: input.createdAt ?? new Date(),
    payloadSnapshot: { title: input.title, detail: input.detail, href: input.href }
  } });
}

function fallback(type: string) {
  if (/SUPPORT|TICKET/.test(type)) return { title: "Поддержка", detail: "Есть обновление по вашему обращению.", href: "/cabinet/support" };
  if (/SESSION|LOGIN|AUTH/.test(type)) return { title: "Безопасность аккаунта", detail: "Есть событие по входу в личный кабинет.", href: "/cabinet/profile" };
  if (/PAYMENT/.test(type)) return { title: "Платежи", detail: "Есть обновление по оплате.", href: "/cabinet/payments" };
  if (/ORDER|ROUTER/.test(type)) return { title: "Заказ роутера", detail: "Есть обновление по заказу роутера.", href: "/cabinet/routers" };
  return { title: "Уведомление", detail: "Новое событие по вашему аккаунту.", href: "/cabinet/profile" };
}

const historyChecked = new Map<string, number>();
async function ensureNotificationHistory(userId: string) {
  if (Date.now() - (historyChecked.get(userId) ?? 0) < 60000) return;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const after = user.notificationFeedClearedAt ? { gt: user.notificationFeedClearedAt } : undefined;
    const [sessions, messages, legacyReplies] = await Promise.all([
      tx.clientSession.findMany({ where: { userId, createdAt: after }, orderBy: { createdAt: "desc" }, take: 20 }),
      tx.supportTicketMessage.findMany({ where: { authorRole: "ADMIN", ticket: { userId }, createdAt: after }, include: { ticket: { select: { id: true, number: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
      tx.supportTicket.findMany({ where: { userId, adminComment: { not: null }, messages: { none: {} } }, orderBy: { updatedAt: "desc" }, take: 30 })
    ]);
    const history: NoticeData[] = [
      ...sessions.map(session => ({ userId, type: "SESSION_LOGIN", relatedType: "ClientSession", relatedId: session.id, title: "Вход выполнен", detail: loginDescription(session.userAgent, session.ipAddress), href: "/cabinet/profile", createdAt: session.createdAt })),
      ...messages.map(message => ({ userId, type: "SUPPORT_REPLY", relatedType: "SupportTicketMessage", relatedId: message.id, title: `Ответ поддержки · #${message.ticket.number}`, detail: message.body, href: `/cabinet/support?ticket=${message.ticket.id}#ticket-${message.ticket.id}`, createdAt: message.createdAt })),
      ...legacyReplies.filter(ticket => ticket.adminComment?.trim() && (!user.notificationFeedClearedAt || (ticket.adminCommentUpdatedAt ?? ticket.createdAt) > user.notificationFeedClearedAt)).map(ticket => ({
        userId, type: "SUPPORT_REPLY", relatedType: "SupportTicket", relatedId: `legacy-admin-${ticket.id}`, title: `Ответ поддержки · #${ticket.number}`,
        detail: ticket.adminComment!, href: `/cabinet/support?ticket=${ticket.id}#ticket-${ticket.id}`, createdAt: ticket.adminCommentUpdatedAt ?? ticket.createdAt
      }))
    ];
    const existing = await tx.notification.findMany({ where: { userId, relatedId: { in: history.map(item => item.relatedId!) } }, select: { type: true, relatedId: true } });
    const known = new Set(existing.map(item => `${item.type}:${item.relatedId}`));
    const missing = history.filter(item => !known.has(`${item.type}:${item.relatedId}`));
    if (missing.length) await tx.notification.createMany({ data: missing.map(item => ({
      userId, type: item.type, relatedType: item.relatedType, relatedId: item.relatedId, createdAt: item.createdAt,
      readAt: user.notificationFeedSeenAt && item.createdAt! <= user.notificationFeedSeenAt ? user.notificationFeedSeenAt : null,
      payloadSnapshot: { title: item.title, detail: item.detail, href: item.href }
    })) });
  });
  if (historyChecked.size >= 2000) historyChecked.clear();
  historyChecked.set(userId, Date.now());
}

export async function getClientNotificationFeed(userId: string) {
  await ensureNotificationHistory(userId);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const asOf = new Date();
    const where = { userId, createdAt: { ...(user.notificationFeedClearedAt ? { gt: user.notificationFeedClearedAt } : {}), lte: asOf } };
    const [records, unreadCount, total] = await Promise.all([
      tx.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 }),
      tx.notification.count({ where: { ...where, readAt: null } }),
      tx.notification.count({ where })
    ]);
    const notifications: ClientNotification[] = records.map(record => {
      const legacy = fallback(record.type.toUpperCase());
      const payload = record.payloadSnapshot as { title?: unknown; detail?: unknown; href?: unknown } | null;
      const href = typeof payload?.href === "string" && /^\/cabinet(?:[/?#]|$)/.test(payload.href) ? payload.href : legacy.href;
      return { id: record.id, type: record.type, createdAt: record.createdAt.toISOString(), readAt: record.readAt?.toISOString() ?? null,
        title: typeof payload?.title === "string" ? payload.title : legacy.title,
        detail: typeof payload?.detail === "string" ? payload.detail : legacy.detail, href };
    });
    return { notifications, unreadCount, asOf: asOf.toISOString(), hasMore: total > notifications.length };
  });
}

function cutoff(value?: string): Date {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 1000) throw new Error("Обновите список уведомлений и повторите действие.");
  return date;
}
export async function markClientNotificationsRead(input: { userId: string; before?: string; notificationId?: string }) {
  const before = cutoff(input.before);
  const readAt = new Date();
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR NO KEY UPDATE`;
    const changed = await tx.notification.updateMany({ where: { userId: input.userId, readAt: null, ...(input.notificationId ? { id: input.notificationId } : { createdAt: { lte: before } }) }, data: { readAt } });
    if (!input.notificationId) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
      if (!user.notificationFeedSeenAt || user.notificationFeedSeenAt < before) await tx.user.update({ where: { id: input.userId }, data: { notificationFeedSeenAt: before } });
    }
    return changed;
  });
  return { readAt: readAt.toISOString(), updatedCount: result.count };
}
export async function clearClientNotificationFeed(input: { userId: string; before?: string }) {
  const before = cutoff(input.before);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR NO KEY UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    const changed = await tx.notification.updateMany({ where: { userId: input.userId, readAt: null, createdAt: { lte: before } }, data: { readAt: new Date() } });
    await tx.user.update({ where: { id: input.userId }, data: {
      notificationFeedClearedAt: user.notificationFeedClearedAt && user.notificationFeedClearedAt > before ? user.notificationFeedClearedAt : before,
      notificationFeedSeenAt: user.notificationFeedSeenAt && user.notificationFeedSeenAt > before ? user.notificationFeedSeenAt : before
    } });
    return changed;
  });
  return { clearedAt: before.toISOString(), updatedCount: result.count };
}
