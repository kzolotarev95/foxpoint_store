import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma.js";
import { config } from "./config.js";
import { businessPlan, businessPlanSchema, moscowDate } from "./business-plans.js";
import { DAY_MS } from "./subscription-period.js";

export const planChangeSchema = z.object({
  plan: businessPlanSchema, price: z.coerce.number().min(0).max(1000000), periodDays: z.coerce.number().int().min(1).max(3650).default(30),
  accessEnabled: z.boolean().default(false), supportType: z.enum(["NONE", "BASIC", "EXTENDED"]).default("NONE"),
  operation: z.enum(["plan_only", "received_payment", "correction"]),
  termPolicy: z.enum(["preserve", "extend", "explicit"]), subscriptionId: z.string().optional(),
  amount: z.coerce.number().min(0).max(1000000).default(0), days: z.coerce.number().int().min(0).max(3650).default(0),
  paidAt: z.string().optional(), effectiveAt: z.string().optional(), method: z.string().trim().min(2).max(120),
  reason: z.string().trim().min(8).max(1000), endAt: z.string().optional(), paymentId: z.string().optional(), requestKey: z.string().uuid()
});
type Change = z.infer<typeof planChangeSchema>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fingerprint=(value:unknown):string=>value && typeof value==="object" && !Array.isArray(value)?JSON.stringify(Object.keys(value).sort().map(key=>[key,fingerprint((value as Record<string,unknown>)[key])])):JSON.stringify(value);
export async function changeAdminPlan(routerId: string, raw: Change) {
  const input = planChangeSchema.parse(raw);
  const conditions = businessPlan(input);
  const now = new Date();
  const paidAt = moscowDate(input.paidAt);
  const effectiveAt = moscowDate(input.effectiveAt);
  if (input.operation === "received_payment" && (input.amount <= 0 || (input.termPolicy === "extend" && input.days <= 0))) throw new Error("Укажите полученную сумму и явно выбранное число оплаченных дней.");
  if (input.termPolicy === "extend" && input.operation !== "received_payment") throw new Error("Начислить дни можно только при регистрации новой оплаты. Для исправления срока укажите согласованное окончание.");
  if (input.plan === "Самостоятельно" && input.operation === "received_payment") throw new Error("Самостоятельное обслуживание не создаёт подписку и оплату периода.");
  let explicitEnd: Date | null = null;
  if (input.termPolicy === "explicit") {
    explicitEnd = input.endAt ? new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.endAt) ? `${input.endAt}:00+03:00` : input.endAt) : null;
    if (!explicitEnd || !Number.isFinite(explicitEnd.getTime()) || explicitEnd <= effectiveAt) throw new Error("Укажите согласованное окончание позже даты начала изменения (МСК).");
  }
  const adminEmail = `admin+${config.ADMIN_USERNAME}@foxpoint.local`;
  const identity = await prisma.authIdentity.upsert({ where: { provider_providerUserId: { provider: "EMAIL", providerUserId: adminEmail } }, update: {}, create: { provider: "EMAIL", providerUserId: adminEmail, email: adminEmail, user: { create: { name: `Admin ${config.ADMIN_USERNAME}`, status: "ACTIVE" } } } });
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Router" WHERE "id" = ${routerId} FOR UPDATE`;
    const key = `plan-change:${input.requestKey}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const repeated = await tx.adminAuditLog.findFirst({ where: { action: "router_plan_changed", afterData: { path: ["operationKey"], equals: key } } });
    if (repeated) {
      if (repeated.entityId !== routerId || fingerprint((repeated.afterData as { input?: unknown }).input) !== fingerprint(input)) throw new Error("Ключ операции уже использован с другими условиями.");
      return { routerId, repeated: true };
    }
    const router = await tx.router.findUniqueOrThrow({ where: { id: routerId }, include: { subscriptions: true, template: true, owner:{select:{archivedAt:true}} } });
    if (router.archivedAt || router.owner.archivedAt) throw new Error("Сначала восстановите клиента и роутер из архива.");
    const candidates = router.subscriptions.filter(s => s.status !== "CANCELLED");
    const selected = input.subscriptionId ? candidates.find(s => s.id === input.subscriptionId) : candidates.length === 1 ? candidates[0] : null;
    if (candidates.length > 1 && !selected && input.plan !== "Самостоятельно") throw new Error("У роутера независимые услуги. Явно выберите изменяемую подписку.");
    if (input.subscriptionId && !selected) throw new Error("Подписка не принадлежит выбранному роутеру.");
    if (selected?.pendingActivation && selected.endAt && !selected.pendingDays) throw new Error("Сначала сверить старые оплаченные дни ожидающей активации подписки.");
    let corrected: Prisma.JsonObject | null = null;
    if (input.operation === "correction") {
      if (!input.paymentId) throw new Error("Для исправления выберите ранее записанную ручную операцию. Исторический импорт исправляется через сверку источника.");
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
      if (payment.routerId !== routerId || payment.provider !== "admin_manual" || payment.status !== "PAID") throw new Error("Исправление доступно только для подтверждённой ручной операции этого роутера.");
      if (input.amount <= 0) throw new Error("Укажите исправленную сумму.");
      corrected = json(payment) as Prisma.JsonObject;
      await tx.payment.update({ where: { id: payment.id }, data: { amount: input.amount, paidAt,
        payloadSnapshot: { ...((payment.payloadSnapshot ?? {}) as Prisma.JsonObject), method: input.method, reason: input.reason, correction: { reason: input.reason, previous: corrected, at: now.toISOString() } } } });
    }
    let endAt = selected?.endAt ?? null;
    let startAt = selected?.startAt ?? null;
    let pendingDays = selected?.pendingDays ?? 0;
    let pendingActivation = selected?.pendingActivation ?? !startAt;
    if (input.termPolicy === "explicit") { endAt = explicitEnd; startAt = startAt ?? effectiveAt; pendingActivation = false; pendingDays = 0; }
    if (input.termPolicy === "extend") {
      if (pendingActivation) { pendingDays += input.days; startAt = null; endAt = null; }
      else { startAt = startAt ?? effectiveAt; endAt = new Date(Math.max(endAt?.getTime() ?? 0, paidAt.getTime(), effectiveAt.getTime()) + input.days * DAY_MS); }
    }
    let paymentId = selected?.lastPaymentId ?? null;
    if (input.operation === "received_payment") {
      const payment = await tx.payment.create({ data: { importKey: key, userId: router.ownerUserId, routerId, provider: "admin_manual", status: "PAID", amount: input.amount, paidAt,
        daysAdded: input.termPolicy === "extend" ? input.days : 0, payloadSnapshot: { type: "plan_change", tariff: input.plan, ...conditions, method: input.method, reason: input.reason,
          termPolicy: input.termPolicy, effectiveAt: effectiveAt.toISOString(), days: input.days, subscriptionId: selected?.id ?? null } } });
      paymentId = payment.id;
    }
    await tx.router.update({ where: { id: routerId }, data: { serviceTariff: input.plan } });
    await tx.subscriptionTemplate.upsert({ where: { routerId }, create: { routerId, ...conditions }, update: conditions });
    if (input.plan === "Самостоятельно") await tx.subscription.updateMany({ where: { routerId }, data: { status: "CANCELLED", pendingActivation: false, pendingDays: 0 } });
    else {
      const data = { accessEnabled: conditions.accessEnabled, supportType: conditions.supportType, priceSnapshot: conditions.currentPrice,
        endAt, startAt, pendingDays, pendingActivation, lastPaymentId: paymentId,
        status: pendingActivation ? pendingDays ? "PENDING_ACTIVATION" as const : "DRAFT" as const : endAt && endAt > now ? "ACTIVE" as const : "EXPIRED" as const };
      if (selected) await tx.subscription.update({ where: { id: selected.id }, data });
      else await tx.subscription.create({ data: { routerId, ...data } });
    }
    const after = await tx.router.findUniqueOrThrow({ where: { id: routerId }, include: { subscriptions: true, template: true } });
    await tx.adminAuditLog.create({ data: { adminId: identity.userId, action: "router_plan_changed", entityType: "Router", entityId: routerId,
      beforeData: json({ router, correctedPayment: corrected }), afterData: json({ router: after, paymentId, reason: input.reason, effectiveAt, operationKey: key, input }) } });
    if(input.operation === "received_payment" && paymentId)await tx.adminAuditLog.create({data:{adminId:identity.userId,action:"subscription_payment_added",entityType:"Payment",entityId:paymentId,
      afterData:json({routerId,amount:input.amount,paidAt,daysAdded:input.termPolicy==="extend"?input.days:0,reason:input.reason,method:input.method})}});
    if(input.operation === "correction" && input.paymentId)await tx.adminAuditLog.create({data:{adminId:identity.userId,action:"payment_corrected",entityType:"Payment",entityId:input.paymentId,
      beforeData:corrected!,afterData:json({amount:input.amount,paidAt,reason:input.reason,method:input.method})}});
    return { routerId, paymentId, repeated: false };
  });
}
