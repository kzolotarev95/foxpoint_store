import { z } from "zod";
import { prisma } from "./prisma.js";
import { CLIENT_USER_WHERE } from "./client-codes.js";
import { DAY_MS } from "./subscription-period.js";

export const adminDatabaseQuery = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().refine(value => [25, 50, 100].includes(value)).optional(),
  plan: z.enum(["", "Сервер", "Техничка", "Полный", "Самостоятельно", "Индивидуальный"]).optional(),
  status: z.enum(["", "ACTIVE", "BLOCKED", "PENDING", "ARCHIVED", "TEST"]).optional(),
  city: z.string().trim().max(80).optional(),
  sort: z.enum(["created", "name", "code", "end"]).optional(),
  expiry: z.enum(["", "soon", "expired", "active", "pending", "none"]).optional(),
  month: z.string().regex(/^(20\d{2})-(0[1-9]|1[0-2])$/).optional(),
  metric: z.enum(["", "clients", "active", "payments", "forecast", "refunds"]).optional(),
  tab: z.enum(["clients", "routers", "subscriptions"]).optional(),
  recordStatus: z.string().trim().max(40).optional(), ticketStatus: z.string().trim().max(40).optional(),
  orderStatus: z.string().trim().max(40).optional(), rewardStatus: z.string().trim().max(40).optional(),
  logAction: z.string().trim().max(100).optional(), logAdmin: z.string().trim().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});
export type AdminDatabaseQuery = z.infer<typeof adminDatabaseQuery>;
export function money(value: number) { return `${value.toLocaleString("ru-RU")} ₽`; }
export function moscowMonth(value?: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const month = value ?? `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
  const [y, m] = month.split("-").map(Number);
  const boundary = (offset: number) => new Date(Date.UTC(y, m - 1 + offset, 1) - 3 * 60 * 60 * 1000);
  return { month, start: boundary(0), end: boundary(1), nextStart: boundary(1), nextEnd: boundary(2), nextMonth: boundary(1).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", month: "long", year: "numeric" }) };
}
export function planName(tariff: string | null, access: boolean, support: string) {
  return tariff ?? (access ? support !== "NONE" ? "Полный" : "Сервер" : support !== "NONE" ? "Техничка" : "Самостоятельно");
}

export async function buildAdminDatabase(input: AdminDatabaseQuery = {}, exportAll = false) {
  const now = new Date();
  const range = moscowMonth(input.month);
  const records = await prisma.user.findMany({
    where: CLIENT_USER_WHERE,
    include: {
      identities: true,
      routers: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: {
        template: true, trial: true,
        subscriptions: { orderBy: [{ endAt: "desc" }, { id: "asc" }], include: { lastPayment: true } },
        payments: { orderBy: [{ paidAt: "desc" }, { id: "desc" }], take: 20 }
      } }
    }
  });
  const rows = records.map(user => {
    const telegram = user.identities.find(i => i.provider === "TELEGRAM");
    const devices = user.routers.map(router => {
      const subs = router.subscriptions.map(s => {
        const effectiveStatus = s.pendingActivation ? "PENDING_ACTIVATION" : s.endAt && s.endAt <= now && s.status === "ACTIVE" ? "EXPIRED" : s.status;
        const paid = !!s.lastPayment && s.lastPayment.status === "PAID" && Number(s.lastPayment.amount) > 0;
        return { id: s.id, accessEnabled: s.accessEnabled, supportType: s.supportType, status: effectiveStatus, pendingDays: s.pendingDays,
          pendingActivation: s.pendingActivation, startAt: s.startAt?.toISOString() ?? null, endAt: s.endAt?.toISOString() ?? null,
          daysRemaining: s.endAt ? Math.max(0, Math.ceil((s.endAt.getTime() - now.getTime()) / DAY_MS)) : null,
          price: Number(s.priceSnapshot), paid,
          isTrial: Number(s.priceSnapshot) === 0 && !!router.trial?.endAt && router.trial.endAt > now };
      });
      const plan = planName(router.serviceTariff, router.template?.accessEnabled ?? subs[0]?.accessEnabled ?? false, router.template?.supportType ?? subs[0]?.supportType ?? "NONE");
      const price = router.template ? Number(router.template.priceOverride ?? router.template.currentPrice) : subs[0]?.price ?? 0;
      return { id: router.id, routerCode: router.routerCode, codeAliases: router.codeAliases, displayName: router.displayName, plan, price, priceLabel: money(price), periodDays: router.template?.periodDays ?? 30,
        model: router.model, serialNumber: router.serialNumber, configurationType: router.configurationType, status: router.status, archivedAt: router.archivedAt?.toISOString() ?? null, adminNote: router.adminNote,
        monitorHost: router.monitorHost, monitorPort: router.monitorPort,
        imported: !!router.importKey, subscriptions: plan === "Самостоятельно" ? [] : subs,
        payments: router.payments.map(p => ({ id: p.id, status: p.status, amount: Number(p.amount), amountLabel: money(Number(p.amount)),
          paidAt: p.paidAt?.toISOString() ?? null, daysAdded: p.daysAdded, allocationNeeded: !!(p.payloadSnapshot as { allocationNeeded?: boolean } | null)?.allocationNeeded,
          imported: p.provider === "client_register_import", provider: p.provider })) };
    });
    const services = devices.flatMap(d => d.subscriptions);
    const active = !user.archivedAt && !user.isTest && user.status === "ACTIVE" && devices.some(d => !d.archivedAt && d.status === "ACTIVE" && d.subscriptions.some(s => s.status === "ACTIVE" && s.paid && !s.pendingActivation && s.startAt && new Date(s.startAt) <= now && !!s.endAt && new Date(s.endAt) > now));
    const serviceState = user.archivedAt ? "Архив" : active ? "Действует" : services.some(s => s.isTrial) ? "Бесплатный тест" : services.some(s => s.pendingActivation) ? "Ожидает активации" : services.some(s => s.status === "EXPIRED") ? "Истекла" : services.some(s => s.status === "PAUSED") ? "Пауза" : devices.length && devices.every(d => d.plan === "Самостоятельно") ? "Без подписки" : "Черновик";
    return { id: user.id, clientCode: user.clientCode, name: user.name, publicName: user.publicName, phone: user.phone, city: user.city,
      email: user.identities.find(i => i.provider === "EMAIL")?.email ?? null, telegram: telegram?.email ?? user.contactTelegram,
      localLogin: user.identities.find(i => i.provider === "LOCAL")?.providerUserId ?? null,
      telegramUsername: telegram?.email?.replace(/^@/, "") ?? user.contactTelegram, hasTelegramIdentity: !!telegram,
      status: user.status, archivedAt: user.archivedAt?.toISOString() ?? null, isTest: user.isTest, active, serviceState,
      balance: Number(user.balance), balanceLabel: money(Number(user.balance)), routerCount: devices.length,
      referralCode: user.clientCode ?? user.id, createdAt: user.createdAt.toISOString(), lastActivityAt: user.lastActivityAt?.toISOString() ?? null, devices };
  });
  const working = rows.filter(r => !r.archivedAt && !r.isTest);
  const paidRecords = await prisma.payment.findMany({
    where: { status: { in: ["PAID", "REFUNDED"] }, user: { is: { AND: [CLIENT_USER_WHERE, { isTest: false }] } },
      OR: [{ paidAt: { gte: range.start, lt: range.end } }, { refundedAt: { gte: range.start, lt: range.end } }] },
    include: { user: { select: { clientCode: true, name: true } }, router: { select: { routerCode: true, displayName: true } } }, orderBy: { paidAt: "desc" }
  });
  const realRecords = paidRecords.filter(p => !["client_register_import", "test", "fixture"].includes(p.provider.toLowerCase()) && (p.payloadSnapshot as { type?: string } | null)?.type !== "client_register_import");
  const paymentDetails = realRecords.filter(p => p.paidAt && p.paidAt >= range.start && p.paidAt < range.end).map(p => ({ id: p.id, userId: p.userId,
    clientCode: p.user.clientCode, name: p.user.name, routerCode: p.router?.routerCode ?? null, amount: Number(p.amount), at: p.paidAt!.toISOString(), provider: p.provider }));
  const refundDetails = realRecords.filter(p => p.refundedAt && p.refundedAt >= range.start && p.refundedAt < range.end).map(p => ({ id: p.id, userId: p.userId,
    clientCode: p.user.clientCode, name: p.user.name, routerCode: p.router?.routerCode ?? null, amount: Number(p.amount), at: p.refundedAt!.toISOString(), provider: p.provider }));
  const forecastDetails: Array<{ id: string; userId: string; clientCode: string | null; name: string | null; routerId: string; routerCode: string | null; plan: string; amount: number; at: string }> = [];
  for (const row of working.filter(r => r.status === "ACTIVE")) for (const d of row.devices.filter(d => !d.archivedAt && d.status === "ACTIVE" && d.plan !== "Самостоятельно")) {
    const unique = new Set<string>();
    const paidServices = d.subscriptions.filter(s => s.status === "ACTIVE" && !s.pendingActivation && s.paid && s.startAt && new Date(s.startAt) <= now && s.endAt && new Date(s.endAt) > now);
    for (const s of paidServices) {
      // A bundle is one expected order. Separate service terms remain separate.
      const key = `${s.accessEnabled}:${s.supportType}:${s.endAt}`;
      if (unique.has(key)) continue;
      unique.add(key);
      const price = paidServices.length === 1 ? d.price : s.price;
      if (price <= 0) continue;
      const periodDays = d.plan === "Индивидуальный" ? Math.max(1, d.periodDays) : 30;
      for (let at = new Date(s.endAt!).getTime(); at < range.nextEnd.getTime(); at += periodDays * DAY_MS) {
        if (at >= range.nextStart.getTime()) forecastDetails.push({ id: `${s.id}:${at}`, userId: row.id, clientCode: row.clientCode, name: row.name,
          routerId: d.id, routerCode: d.routerCode, plan: d.plan, amount: price, at: new Date(at).toISOString() });
      }
    }
  }
  const normalize = (text: string) => text.toLocaleLowerCase("ru-RU").replace(/[\s()+@-]/g, "");
  const needle = normalize(input.q ?? "");
  const filtered = rows.filter(row => {
    if (needle && !normalize([row.id, row.clientCode, row.name, row.city, row.phone, row.email, row.telegram, ...row.devices.flatMap(d => [d.displayName, d.routerCode, ...d.codeAliases])].join(" ")).includes(needle)) return false;
    if (input.plan && !row.devices.some(d => d.plan === input.plan)) return false;
    if (input.city && !normalize(row.city ?? "").includes(normalize(input.city))) return false;
    if (input.status === "ARCHIVED" ? !row.archivedAt : input.status === "TEST" ? !row.isTest : input.status && row.status !== input.status) return false;
    if (input.metric === "clients" && (row.archivedAt || row.isTest)) return false;
    if (input.metric === "active" && !row.active) return false;
    const subs = row.devices.flatMap(d => d.subscriptions);
    if (input.expiry === "soon" && !subs.some(s => s.status === "ACTIVE" && (s.daysRemaining ?? 999) <= 5)) return false;
    if (input.expiry === "expired" && !subs.some(s => s.status === "EXPIRED")) return false;
    if (input.expiry === "active" && !row.active) return false;
    if (input.expiry === "pending" && !subs.some(s => s.pendingActivation)) return false;
    if (input.expiry === "none" && !row.devices.every(d => d.plan === "Самостоятельно")) return false;
    return true;
  });
  const endValue = (r: typeof rows[number]) => Math.min(...r.devices.flatMap(d => d.subscriptions.filter(s => s.endAt && !["CANCELLED", "DRAFT"].includes(s.status)).map(s => new Date(s.endAt!).getTime())), Infinity);
  filtered.sort((a, b) => {
    const result = input.sort === "name" ? (a.name ?? "").localeCompare(b.name ?? "", "ru") : input.sort === "end" ? endValue(a) - endValue(b) : input.sort === "code" ? (a.clientCode ?? "").localeCompare(b.clientCode ?? "") : b.createdAt.localeCompare(a.createdAt);
    return result || a.id.localeCompare(b.id);
  });
  const size = input.pageSize ?? 25;
  const page = Math.min(input.page ?? 1, Math.max(1, Math.ceil(filtered.length / size)));
  const total = paymentDetails.reduce((sum, p) => sum + p.amount, 0);
  const refunds = refundDetails.reduce((sum, p) => sum + p.amount, 0);
  const forecast = forecastDetails.reduce((sum, p) => sum + p.amount, 0);
  const matched = new Set(filtered.map(r => r.id));
  return {
    clients: exportAll ? filtered : filtered.slice((page - 1) * size, page * size),
    clientCount: filtered.length, clientQuery: input.q ?? "", clientPage: page, clientPageSize: size, clientPlan: input.plan ?? "", clientStatus: input.status ?? "", clientCity: input.city ?? "", clientSort: input.sort ?? "created", clientExpiry: input.expiry ?? "",
    selection: { routers: filtered.reduce((sum, r) => sum + r.routerCount, 0), periodPrice: filtered.reduce((sum, r) => sum + r.devices.reduce((v, d) => v + d.price, 0), 0), payments: paymentDetails.filter(p => matched.has(p.userId)).reduce((sum, p) => sum + p.amount, 0) },
    dashboard: { month: range.month, nextMonth: range.nextMonth, totalClients: working.length, archivedClients: rows.filter(r => r.archivedAt).length, testClients: rows.filter(r => r.isTest).length,
      activeClients: working.filter(r => r.active).length, confirmedPayments: total, confirmedPaymentsLabel: money(total), refunds, refundsLabel: money(refunds),
      nextMonthForecast: forecast, nextMonthForecastLabel: money(forecast), nextMonthRouters: new Set(forecastDetails.map(f => f.routerId)).size, nextMonthOrders: forecastDetails.length,
      activeDevices: working.flatMap(r => r.devices).filter(d => !d.archivedAt && d.status === "ACTIVE").length,
      activeSubscriptions: working.flatMap(r => r.devices).filter(d => !d.archivedAt).flatMap(d => d.subscriptions).filter(s => s.status === "ACTIVE" && !s.pendingActivation).length,
      selfServiceClients: working.filter(r => r.devices.some(d => d.plan === "Самостоятельно")).length,
      freeTests: working.flatMap(r => r.devices).filter(d => d.subscriptions.some(s => s.isTrial)).length,
      overdue: working.filter(r => r.devices.some(d => d.subscriptions.some(s => s.status === "EXPIRED"))).length,
      asOf: now.toISOString(), paymentDetails, refundDetails, forecastDetails }
  };
}
