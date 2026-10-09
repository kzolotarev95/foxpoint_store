import { z } from "zod";
import type { Prisma, SupportType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { assignMissingCodes } from "./client-codes.js";
import { DAY_MS, SUBSCRIPTION_MONTH_DAYS } from "./subscription-period.js";

export const clientDatabaseSchema = z.array(z.object({
  clientCode: z.string().regex(/^CLI-\d{4,}$/),
  name: z.string().trim().min(1).max(120),
  phone: z.string().max(120).nullable(),
  telegram: z.string().max(120).nullable(),
  city: z.string().max(120).nullable(),
  routerName: z.string().trim().min(1).max(120),
  tariff: z.enum(["Сервер", "Техничка", "Полный", "Самостоятельно", "Индивидуальный"]),
  state: z.enum(["Активен", "Пауза", "Архив"]),
  monthlyPrice: z.number().nonnegative().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  paidMonths: z.number().int().min(0).max(120),
  paidAmount: z.number().nonnegative().nullable(),
  note: z.string().max(1000).nullable()
})).min(1).max(1000);

export type ClientDatabaseRow = z.infer<typeof clientDatabaseSchema>[number];

export function getImportPlan(row: ClientDatabaseRow) {
  if (row.tariff === "Индивидуальный" && (row.monthlyPrice == null || row.monthlyPrice <= 0)) {
    throw new Error(`Для индивидуального тарифа укажите явную стоимость: ${row.clientCode}`);
  }
  if (row.tariff === "Самостоятельно" && (row.paidAmount ?? 0) > 0) {
    throw new Error(`Для тарифа «Самостоятельно» нельзя указывать оплату: ${row.clientCode}`);
  }
  const accessEnabled = row.tariff === "Сервер" || row.tariff === "Полный";
  const supportType: SupportType = ["Техничка", "Полный", "Индивидуальный"].includes(row.tariff) ? "BASIC" : "NONE";
  const monthlyPrice = row.tariff === "Самостоятельно" ? 0
    : row.tariff === "Индивидуальный" ? row.monthlyPrice!
    : row.paidMonths && row.paidAmount != null ? row.paidAmount / row.paidMonths
    : row.tariff === "Полный" ? 2000 : 1000;
  const startAt = row.startDate ? new Date(`${row.startDate}T00:00:00+04:00`) : null;
  if (startAt && (Number.isNaN(startAt.getTime()) ||
    new Date(startAt.getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10) !== row.startDate)) {
    throw new Error(`Некорректная дата: ${row.clientCode}`);
  }
  const daysAdded = row.tariff === "Самостоятельно" ? 0 : row.paidMonths * SUBSCRIPTION_MONTH_DAYS;
  const endAt = startAt && daysAdded ? new Date(startAt.getTime() + daysAdded * DAY_MS) : null;
  return { accessEnabled, supportType, monthlyPrice, startAt, daysAdded, endAt };
}

export function validateClientDatabase(input: unknown): ClientDatabaseRow[] {
  const rows = clientDatabaseSchema.parse(input);
  const keys = new Set<string>();
  for (const row of rows) {
    const key = `${row.clientCode}:${row.routerName}`;
    if (keys.has(key)) throw new Error(`Повторная строка: ${key}`);
    keys.add(key);
    if (row.paidMonths && !row.startDate) throw new Error(`Укажите дату первой подписки: ${row.clientCode}`);
    getImportPlan(row);
  }
  return rows;
}

export async function importClientDatabase(input: unknown) {
  const rows = validateClientDatabase(input);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(746021)`;
    let createdClients = 0;
    let createdRouters = 0;
    let skipped = 0;
    for (const row of rows) {
      const importKey = `client-register-v1:${row.clientCode}:${row.routerName}`;
      const importedRouter = await tx.router.findUnique({ where: { importKey } });
      // Repeated imports never overwrite later edits or renewals.
      if (importedRouter) { skipped++; continue; }
      const plan = getImportPlan(row);
      let user = await tx.user.findUnique({ where: { clientCode: row.clientCode } });
      if (!user) {
        user = await tx.user.create({ data: {
          clientCode: row.clientCode, name: row.name, phone: row.phone, city: row.city,
          contactTelegram: row.telegram?.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "") ?? null,
          status: "ACTIVE", archivedAt: row.state === "Архив" ? new Date() : null, isTest: row.clientCode === "CLI-0001"
        } });
        createdClients++;
      }
      // A pre-existing code is only safe when it identifies the same register client.
      if (user.name !== row.name) throw new Error(`Код ${row.clientCode} уже принадлежит другому клиенту. Импорт отменён.`);
      const router = await tx.router.findFirst({ where: { ownerUserId: user.id, displayName: row.routerName } });
      if (router) throw new Error(`Роутер ${row.routerName} уже существует без отметки импорта. Проверьте привязку.`);
      const createdRouter = await tx.router.create({ data: {
        importKey, importSnapshot: row as Prisma.InputJsonValue,
        ownerUserId: user.id, displayName: row.routerName, serviceTariff: row.tariff,
        configurationType: "EXTENDED", adminNote: row.note,
        status: row.state === "Архив" ? "DISABLED" : row.state === "Пауза" ? "SUSPENDED" : "ACTIVE"
      } });
      createdRouters++;
      await tx.subscriptionTemplate.create({ data: {
        routerId: createdRouter.id, accessEnabled: plan.accessEnabled, supportType: plan.supportType,
        periodDays: SUBSCRIPTION_MONTH_DAYS, currentPrice: plan.monthlyPrice, priceOverride: plan.monthlyPrice
      } });
      const payment = row.tariff !== "Самостоятельно" && plan.daysAdded ? await tx.payment.create({ data: {
        importKey, userId: user.id, routerId: createdRouter.id, provider: "client_register_import",
        amount: row.paidAmount ?? plan.monthlyPrice * row.paidMonths,
        daysAdded: plan.daysAdded, status: "PAID", paidAt: plan.startAt,
        payloadSnapshot: { type: "client_register_import", source: "FOX POINT — База клиентов и роутеров.xlsx", tariff: row.tariff,
          paidMonths: row.paidMonths, importedAt: new Date().toISOString() } as Prisma.InputJsonValue
      } }) : null;
      if (row.tariff !== "Самостоятельно") {
        await tx.subscription.create({ data: {
          routerId: createdRouter.id, accessEnabled: plan.accessEnabled, supportType: plan.supportType,
          priceSnapshot: plan.monthlyPrice, startAt: plan.startAt, endAt: plan.endAt,
          lastPaymentId: payment?.id,
          status: row.state !== "Активен" ? "PAUSED" : !plan.endAt ? "DRAFT"
            : plan.endAt.getTime() > Date.now() ? "ACTIVE" : "EXPIRED"
        } });
      }
    }
    await assignMissingCodes(tx);
    return { createdClients, createdRouters, skipped, total: rows.length };
  }, { timeout: 60000 });
}
