import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import net from "node:net";
import { buildAdminDatabase, type AdminDatabaseQuery } from "./admin-database.js";
import { importReconciliation } from "./import-reconciliation.js";
import { businessPlan, moscowDate, type BusinessPlan } from "./business-plans.js";
import { registerPage, safeAudit, adminAuditObjects } from "./admin-register.js";
import {
  ConfigurationType,
  OrderStatus,
  PaymentStatus,
  RewardStatus,
  RouterStatus,
  SubscriptionStatus,
  SupportType,
  TicketStatus,
  TicketMessageAuthorRole,
  UserStatus,
  type Prisma
} from "@prisma/client";
import {
  bindEmailIdentityForUser,
  buildReferralCode,
  listClientSessionsForUser,
  normalizeClientLogin,
  upsertLocalCredentialsForUser
} from "./client-auth.js";
import { getAdminSettings, getPublicSettingLinks } from "./admin-settings.js";
import { config } from "./config.js";
import { prisma } from "./prisma.js";
import { assignMissingCodes, CLIENT_USER_WHERE, ensureClientAndRouterCodes } from "./client-codes.js";
import { DAY_MS, extendSubscriptionEnd, SUBSCRIPTION_MONTH_DAYS } from "./subscription-period.js";
import { createClientNotification, getClientNotificationFeed } from "./notifications.js";

type SettingMap = Map<string, string>;
type PublicLinks = Awaited<ReturnType<typeof getPublicSettingLinks>>;
type PaymentProviderId = "manual_mvp" | "platega" | "yookassa" | "yoomoney";
type ClientPaymentMethodId = Exclude<PaymentProviderId, "manual_mvp">;
type RouterTemplateLike = {
  accessEnabled: boolean;
  supportType: SupportType;
};
type TicketMessageView = {
  authorRole: TicketMessageAuthorRole;
  body: string;
  createdAt: string;
  id: string;
};
type RouterMonitorTarget = {
  host: string;
  ports: number[];
};
type RouterLiveCheckResult = {
  checkedAt: string | null;
  reachable: boolean | null;
};

const DEFAULT_ROUTER_CHECK_PORTS = [80, 443, 8080, 8443];
const ROUTER_CHECK_TIMEOUT_MS = 1200;

function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) {
    return 0;
  }

  return Number(value);
}

function formatMoney(amount: number): string {
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

function mapSupportTicketMessages(input: {
  adminComment: string | null;
  adminCommentUpdatedAt: Date | null;
  createdAt: Date;
  description: string;
  id: string;
  messages: Array<{
    authorRole: TicketMessageAuthorRole;
    body: string;
    createdAt: Date;
    id: string;
  }>;
}): TicketMessageView[] {
  if (input.messages.length) {
    return input.messages.map((message) => ({
      authorRole: message.authorRole,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      id: message.id
    }));
  }

  const legacyMessages: TicketMessageView[] = [
    {
      authorRole: "CLIENT",
      body: input.description,
      createdAt: input.createdAt.toISOString(),
      id: `legacy-client-${input.id}`
    }
  ];

  if (input.adminComment) {
    legacyMessages.push({
      authorRole: "ADMIN",
      body: input.adminComment,
      createdAt: (input.adminCommentUpdatedAt ?? input.createdAt).toISOString(),
      id: `legacy-admin-${input.id}`
    });
  }

  return legacyMessages;
}

async function appendSupportTicketMessage(input: {
  authorRole: TicketMessageAuthorRole;
  body: string;
  ticketId: string;
}) {
  const ticket = await prisma.supportTicket.findUnique({
    where: {
      id: input.ticketId
    }
  });

  if (!ticket) {
    throw new Error("Обращение не найдено.");
  }

  if (ticket.status === "CLOSED") {
    throw new Error("Обращение закрыто. Отправка сообщений недоступна.");
  }

  const cleanedBody = input.body.trim();
  if (!cleanedBody) {
    throw new Error("Сообщение не может быть пустым.");
  }

  const createdAt = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.supportTicketMessage.create({
      data: {
        authorRole: input.authorRole,
        body: cleanedBody,
        ticketId: input.ticketId
      }
    });

    const nextStatus =
      input.authorRole === "CLIENT"
        ? ticket.status === "OPEN" || ticket.status === "WAITING_CLIENT" || ticket.status === "RESOLVED"
          ? "IN_PROGRESS"
          : ticket.status
        : ticket.status === "OPEN"
          ? "IN_PROGRESS"
          : ticket.status;

    await tx.supportTicket.update({
      where: {
        id: input.ticketId
      },
      data: {
        adminComment: input.authorRole === "ADMIN" ? cleanedBody : ticket.adminComment,
        adminCommentUpdatedAt: input.authorRole === "ADMIN" ? createdAt : ticket.adminCommentUpdatedAt,
        status: nextStatus as TicketStatus
      }
    });

    if (input.authorRole === "ADMIN") await createClientNotification(tx, { userId: ticket.userId, type: "SUPPORT_REPLY", relatedType: "SupportTicketMessage", relatedId: createdMessage.id,
      title: `Ответ поддержки · #${ticket.number}`, detail: cleanedBody, href: `/cabinet/support?ticket=${ticket.id}#ticket-${ticket.id}` });
    return createdMessage;
  });

  return {
    authorRole: message.authorRole,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    id: message.id
  };
}

function getDaysRemaining(endAt: Date | null | undefined): number | null {
  if (!endAt) {
    return null;
  }

  const diff = endAt.getTime() - Date.now();
  if (diff <= 0) {
    return 0;
  }

  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function extractRouterMonitorTarget(value: string | null | undefined): RouterMonitorTarget | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\b((?:\d{1,3}\.){3}\d{1,3})(?::(\d{2,5}))?\b/);
  if (!match) {
    return null;
  }

  const host = match[1];
  const customPort = Number(match[2] ?? "");

  if (Number.isInteger(customPort) && customPort > 0 && customPort <= 65535) {
    return {
      host,
      ports: [customPort]
    };
  }

  return {
    host,
    ports: DEFAULT_ROUTER_CHECK_PORTS
  };
}

function probeRouterPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(ROUTER_CHECK_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

async function runRouterLiveCheck(host: string | null | undefined, port = 443): Promise<RouterLiveCheckResult> {
  if (!host || !net.isIP(host) || port < 1 || port > 65535) {
    return {
      checkedAt: null,
      reachable: null
    };
  }

  const reachable = await probeRouterPort(host, port);
  return {
    checkedAt: new Date().toISOString(),
    reachable
  };
}

const AUTO_EXPIRE_SUBSCRIPTION_STATUSES = new Set(["ACTIVE", "PENDING_ACTIVATION", "READY"]);

function getEffectiveSubscriptionStatus(
  subscription:
    | {
        status: string;
        endAt: Date | null;
        pendingActivation?: boolean | null;
      }
    | null
    | undefined
): string | null {
  if (!subscription) {
    return null;
  }

  if (subscription.endAt && subscription.endAt.getTime() <= Date.now() && AUTO_EXPIRE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    return "EXPIRED";
  }

  if (subscription.pendingActivation || subscription.status === "PENDING_ACTIVATION") {
    return "PENDING_ACTIVATION";
  }

  return subscription.status;
}

function pickCurrentSubscription<T extends { status: string; endAt: Date | null; pendingActivation?: boolean | null }>(
  subscriptions: T[]
): T | null {
  return (
    subscriptions.find((subscription) => getEffectiveSubscriptionStatus(subscription) === "ACTIVE") ??
    subscriptions.find((subscription) => getEffectiveSubscriptionStatus(subscription) === "PENDING_ACTIVATION") ??
    subscriptions[0] ??
    null
  );
}

async function getSettingMap(): Promise<SettingMap> {
  const settings = await getAdminSettings();
  return new Map(settings.map((setting) => [setting.key, setting.value]));
}

function getNumericSetting(settings: SettingMap, key: string, fallback: number): number {
  const rawValue = settings.get(key);
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBooleanSetting(settings: SettingMap, key: string, fallback = false): boolean {
  const rawValue = settings.get(key)?.trim().toLowerCase();
  if (!rawValue) {
    return fallback;
  }

  return rawValue === "true" || rawValue === "1" || rawValue === "yes" || rawValue === "on";
}

function getSettingValue(settings: SettingMap, key: string, fallback = ""): string {
  const value = settings.get(key)?.trim();
  return value || fallback;
}

function ensureConfiguredSetting(settings: SettingMap, key: string, label: string, placeholder?: string): string {
  const value = getSettingValue(settings, key);
  if (!value || (placeholder && value === placeholder)) {
    throw new Error(`Настройте "${label}" в админке, чтобы принимать оплату этим способом.`);
  }

  return value;
}

function formatDecimalAmount(amount: number): string {
  return amount.toFixed(2);
}

function buildPaymentLabel(paymentId: string): string {
  return `fp_${paymentId}`;
}

function extractPaymentIdFromLabel(label: string | null | undefined): string | null {
  if (!label) {
    return null;
  }

  return label.startsWith("fp_") ? label.slice(3) : null;
}

function buildCallbackUrl(links: PublicLinks, provider: ClientPaymentMethodId): string {
  return `${links.apiUrl}/api/payments/${provider}/callback`;
}

function buildCabinetPaymentSuccessUrl(links: PublicLinks): string {
  return `${links.appUrl}/cabinet/payments?success=${encodeURIComponent("Оплата принята. Статус обновится автоматически.")}`;
}

function buildCabinetPaymentFailedUrl(links: PublicLinks): string {
  return `${links.appUrl}/cabinet/payments?error=${encodeURIComponent("Платеж не был завершен.")}`;
}

function buildCabinetPaymentsUrl(links: PublicLinks): string {
  return `${links.appUrl}/cabinet/payments`;
}

function buildYooMoneyCheckoutUrl(links: PublicLinks, paymentId: string): string {
  return `${links.apiUrl}/api/payments/${paymentId}/checkout`;
}

function getYooMoneyPaymentType(settings: SettingMap): "AC" | "PC" {
  return getSettingValue(settings, "yoomoney_payment_type", "AC").toUpperCase() === "PC" ? "PC" : "AC";
}

function getEnabledPaymentMethods(settings: SettingMap) {
  return [
    {
      id: "platega" as const,
      label: "Platega",
      description: "Быстрый checkout с автоматическим подтверждением статуса.",
      enabled: isPaymentProviderAvailable(settings, "platega")
    },
    {
      id: "yookassa" as const,
      label: "ЮKassa",
      description: "Оплата банковской картой и другими способами через ЮKassa.",
      enabled: isPaymentProviderAvailable(settings, "yookassa")
    },
    {
      id: "yoomoney" as const,
      label: "ЮMoney",
      description: "Оплата через кошелек ЮMoney или банковскую карту.",
      enabled: isPaymentProviderAvailable(settings, "yoomoney")
    }
  ];
}

function isPaymentProviderAvailable(settings: SettingMap, provider: ClientPaymentMethodId): boolean {
  if (provider === "platega") {
    return getBooleanSetting(settings, "platega_enabled", true) && isPlategaConfigured(settings);
  }

  if (provider === "yookassa") {
    return getBooleanSetting(settings, "yookassa_enabled", true) && isYooKassaConfigured(settings);
  }

  return getBooleanSetting(settings, "yoomoney_enabled", true) && isYooMoneyConfigured(settings);
}

function isPlategaConfigured(settings: SettingMap): boolean {
  return Boolean(
    getSettingValue(settings, "platega_api_base_url") &&
      getSettingValue(settings, "platega_merchant_id") &&
      getSettingValue(settings, "platega_secret") &&
      getSettingValue(settings, "platega_merchant_id") !== "merchant-id-change-me" &&
      getSettingValue(settings, "platega_secret") !== "platega-secret-change-me"
  );
}

function isYooMoneyConfigured(settings: SettingMap): boolean {
  return Boolean(
    getSettingValue(settings, "yoomoney_receiver") &&
      getSettingValue(settings, "yoomoney_receiver") !== "41001xxxxxxxxxxxx" &&
      getSettingValue(settings, "yoomoney_notification_secret") &&
      getSettingValue(settings, "yoomoney_notification_secret") !== "yoomoney-secret-change-me"
  );
}

function isYooKassaConfigured(settings: SettingMap): boolean {
  return Boolean(
    getSettingValue(settings, "yookassa_shop_id") &&
      getSettingValue(settings, "yookassa_shop_id") !== "shop-id-change-me" &&
      getSettingValue(settings, "yookassa_secret_key") &&
      getSettingValue(settings, "yookassa_secret_key") !== "yookassa-secret-change-me"
  );
}

function getPaymentProviderLabel(provider: string): string {
  if (provider === "client_register_import") return "Перенесено из базы клиентов";
  if (provider === "admin_manual") return "Оплата записана администратором";
  if (provider === "platega") {
    return "Platega";
  }

  if (provider === "yookassa") {
    return "ЮKassa";
  }

  if (provider === "yoomoney") {
    return "ЮMoney";
  }

  return "Ручная оплата";
}

function resolveRequestedPaymentProvider(
  settings: SettingMap,
  requestedProvider: string | null | undefined
): PaymentProviderId {
  const normalized = requestedProvider?.trim().toLowerCase();
  if (normalized === "platega" || normalized === "yookassa" || normalized === "yoomoney") {
    if (isPaymentProviderAvailable(settings, normalized)) {
      return normalized;
    }

    throw new Error(`Способ оплаты "${getPaymentProviderLabel(normalized)}" не настроен в админке.`);
  }

  if (isPaymentProviderAvailable(settings, "platega")) {
    return "platega";
  }

  if (isPaymentProviderAvailable(settings, "yookassa")) {
    return "yookassa";
  }

  if (isPaymentProviderAvailable(settings, "yoomoney")) {
    return "yoomoney";
  }

  return "manual_mvp";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeRfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (symbol) =>
    `%${symbol.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildYooMoneyNotificationSignature(
  payload: Record<string, string>,
  secret: string
): string {
  const signatureBase = Object.entries(payload)
    .filter(([key]) => key !== "sign")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeRfc3986Component(value)}`)
    .join("&");

  return createHmac("sha256", secret).update(signatureBase).digest("hex");
}

function hasMatchingSignature(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

async function createPlategaTransaction(input: {
  amount: number;
  description: string;
  links: PublicLinks;
  paymentId: string;
  settings: SettingMap;
  userId: string;
}) {
  const merchantId = ensureConfiguredSetting(
    input.settings,
    "platega_merchant_id",
    "Platega Merchant ID",
    "merchant-id-change-me"
  );
  const secret = ensureConfiguredSetting(
    input.settings,
    "platega_secret",
    "Platega Secret",
    "platega-secret-change-me"
  );
  const apiBaseUrl = ensureConfiguredSetting(input.settings, "platega_api_base_url", "Platega API URL").replace(
    /\/+$/,
    ""
  );
  const response = await fetch(`${apiBaseUrl}/transaction/process`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-MerchantId": merchantId,
      "X-Secret": secret
    },
    body: JSON.stringify({
      description: input.description,
      failedUrl: buildCabinetPaymentFailedUrl(input.links),
      metadata: {
        callback: buildCallbackUrl(input.links, "platega"),
        userId: input.userId
      },
      payload: input.paymentId,
      paymentDetails: {
        amount: input.amount,
        currency: "RUB"
      },
      return: buildCabinetPaymentSuccessUrl(input.links)
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        redirect?: string;
        status?: string;
        transactionId?: string;
      }
    | null;

  if (!response.ok || !payload?.transactionId || !payload.redirect) {
    throw new Error("Platega не вернула ссылку на оплату. Проверьте Merchant ID, Secret и базовый URL API.");
  }

  return {
    paymentUrl: payload.redirect,
    providerPaymentId: payload.transactionId
  };
}

type YooKassaPaymentResponse = {
  amount?: {
    currency?: string;
    value?: string;
  };
  confirmation?: {
    confirmation_url?: string;
    type?: string;
  };
  id?: string;
  metadata?: Record<string, unknown> | null;
  status?: string;
};

function getYooKassaAuthorizationHeader(settings: SettingMap): string {
  const shopId = ensureConfiguredSetting(settings, "yookassa_shop_id", "ЮKassa Shop ID", "shop-id-change-me");
  const secretKey = ensureConfiguredSetting(settings, "yookassa_secret_key", "ЮKassa Secret Key", "yookassa-secret-change-me");
  return `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`;
}

async function createYooKassaTransaction(input: {
  amount: number;
  description: string;
  links: PublicLinks;
  metadata?: Record<string, string>;
  paymentId: string;
  settings: SettingMap;
}) {
  const response = await fetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: getYooKassaAuthorizationHeader(input.settings),
      "Content-Type": "application/json",
      "Idempotence-Key": randomUUID()
    },
    body: JSON.stringify({
      amount: {
        currency: "RUB",
        value: formatDecimalAmount(input.amount)
      },
      capture: true,
      confirmation: {
        return_url: buildCabinetPaymentsUrl(input.links),
        type: "redirect"
      },
      description: input.description,
      metadata: {
        foxpoint_payment_id: input.paymentId,
        ...(input.metadata ?? {})
      }
    })
  });

  const payload = (await response.json().catch(() => null)) as YooKassaPaymentResponse | null;

  if (!response.ok || !payload?.id || !payload.confirmation?.confirmation_url) {
    throw new Error("ЮKassa не вернула ссылку на оплату. Проверьте Shop ID, Secret Key и настройки магазина.");
  }

  return {
    paymentUrl: payload.confirmation.confirmation_url,
    providerPaymentId: payload.id
  };
}

async function fetchYooKassaPayment(input: { paymentId: string; settings: SettingMap }) {
  const response = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(input.paymentId)}`, {
    headers: {
      Accept: "application/json",
      Authorization: getYooKassaAuthorizationHeader(input.settings)
    }
  });

  const payload = (await response.json().catch(() => null)) as YooKassaPaymentResponse | null;

  if (!response.ok || !payload?.id) {
    throw new Error("Не удалось получить данные платежа YooKassa.");
  }

  return payload;
}

async function applyPaymentSuccess(input: {
  paidAt?: Date;
  paymentId: string;
  providerPaymentId?: string | null;
  providerStatus?: string | null;
}) {
  const payment = await prisma.payment.findUnique({
    where: {
      id: input.paymentId
    }
  });

  if (!payment) {
    throw new Error("Платеж не найден.");
  }

  if (payment.status === "PAID" || payment.status === "REFUNDED") {
    return {
      paymentId: payment.id,
      status: payment.status
    };
  }

  const snapshot = (payment.payloadSnapshot ?? {}) as {
    accessEnabled?: boolean;
    requiresActivation?: boolean;
    supportType?: SupportType;
    type?: string;
    periodPrice?: number;
  };

  let applied = false;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: ["CREATED", "PENDING", "FAILED"] }
      },
      data: {
        paidAt: input.paidAt ?? payment.paidAt ?? new Date(),
        providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
        payloadSnapshot: {
          ...(snapshot as Record<string, unknown>),
          providerStatus: input.providerStatus ?? null
        } as Prisma.InputJsonValue,
        status: "PAID"
      }
    });
    if (!claimed.count) return;
    applied = true;
    if (payment.routerId) {
      await tx.$queryRaw`SELECT "id" FROM "Router" WHERE "id" = ${payment.routerId} FOR UPDATE`;
    }

    if (payment.orderId) {
      await tx.routerOrder.update({
        where: {
          id: payment.orderId
        },
        data: {
          status: "PAID"
        }
      });
    }

    await createClientNotification(tx, { userId: payment.userId, type: "PAYMENT_PAID", relatedType: "Payment", relatedId: payment.id,
      title: "Оплата подтверждена", detail: `${formatMoney(toNumber(payment.amount))} · оплата учтена в личном кабинете.`, href: "/cabinet/payments" });

    if (!payment.routerId) {
      return;
    }

    const router = await tx.router.findUnique({
      where: {
        id: payment.routerId
      },
      include: {
        subscriptions: {
          orderBy: {
            endAt: "desc"
          }
        },
        template: true, trial: true
      }
    });

    if (!router) {
      return;
    }

    const unallocated = snapshot.accessEnabled === undefined || snapshot.supportType === undefined || !payment.daysAdded ||
      router.serviceTariff === "Самостоятельно" || router.subscriptions.some(s => s.pendingActivation && !s.pendingDays && s.endAt);
    if (unallocated) {
      await tx.payment.update({ where: { id: payment.id }, data: { payloadSnapshot: { ...snapshot, providerStatus: input.providerStatus ?? null,
        allocationNeeded: true, allocationReason: "Сверить назначение оплаты и сохранённые дни ожидания активации" } as Prisma.InputJsonValue } });
      return;
    }

    const accessEnabled = snapshot.accessEnabled ?? router.template?.accessEnabled ?? false;
    const supportType = snapshot.supportType ?? router.template?.supportType ?? "NONE";
    const currentSubscription = pickCurrentSubscription(router.subscriptions.filter(s => s.accessEnabled === accessEnabled && s.supportType === supportType));
    const trialActive = !!router.trial?.startAt && !!router.trial.endAt && router.trial.endAt > new Date() && (() => {
      const trial = router.trial.packageSnapshot as { accessEnabled?: boolean; supportType?: string } | null;
      return (!accessEnabled || !!trial?.accessEnabled) && (supportType === "NONE" || trial?.supportType === supportType);
    })();
    const requiresActivation = currentSubscription?.pendingActivation || (currentSubscription?.startAt || trialActive ? false : snapshot.requiresActivation ?? true);
    const periodDays = payment.daysAdded ?? SUBSCRIPTION_MONTH_DAYS;
    const now = input.paidAt ?? new Date();
    const activeEndAt = currentSubscription?.endAt ?? (trialActive ? router.trial!.endAt : null);
    const nextEndAt = requiresActivation ? null : extendSubscriptionEnd(activeEndAt, periodDays, now);
    const pendingDays = requiresActivation ? (currentSubscription?.pendingDays ?? 0) + periodDays : 0;
    const periodPrice = snapshot.periodPrice ?? toNumber(router.template?.priceOverride ?? router.template?.currentPrice ?? payment.amount);
    await tx.payment.update({ where: { id: payment.id }, data: { daysAdded: periodDays } });

    if (currentSubscription) {
      await tx.subscription.update({
        where: {
          id: currentSubscription.id
        },
        data: {
          accessEnabled,
          endAt: nextEndAt,
          lastPaymentId: payment.id,
          pendingActivation: requiresActivation,
          pendingDays,
          priceSnapshot: periodPrice,
          startAt: requiresActivation ? null : currentSubscription.startAt ?? now,
          status: requiresActivation ? "PENDING_ACTIVATION" : "ACTIVE",
          supportType
        }
      });

      return;
    }

    await tx.subscription.create({
      data: {
        accessEnabled,
        endAt: nextEndAt,
        lastPaymentId: payment.id,
        pendingActivation: requiresActivation,
        pendingDays,
        priceSnapshot: periodPrice,
        routerId: payment.routerId,
        startAt: requiresActivation ? null : now,
        status: requiresActivation ? "PENDING_ACTIVATION" : "ACTIVE",
        supportType
      }
    });
  });

  if (applied) await recordAdminAction({
    action: "payment_paid",
    entityType: "Payment",
    entityId: payment.id,
    afterData: {
      paidAt: (input.paidAt ?? new Date()).toISOString(),
      providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId ?? null,
      providerStatus: input.providerStatus ?? null,
      status: "PAID"
    }
  });

  return {
    paymentId: payment.id,
    status: applied ? "PAID" : (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } })).status
  };
}

async function applyPaymentFailure(input: {
  paymentId: string;
  providerPaymentId?: string | null;
  providerStatus?: string | null;
  status: "CANCELED" | "FAILED" | "REFUNDED";
}) {
  const payment = await prisma.payment.findUnique({
    where: {
      id: input.paymentId
    }
  });

  if (!payment) {
    throw new Error("Платеж не найден.");
  }

  if (payment.status === "REFUNDED" || payment.status === input.status || (payment.status === "PAID" && input.status !== "REFUNDED")) {
    return {
      paymentId: payment.id,
      status: payment.status
    };
  }

  const changed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE`;
    const previous = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (previous.status === "REFUNDED" || previous.status === input.status || (previous.status === "PAID" && input.status !== "REFUNDED")) return false;
    await tx.payment.update({ where: { id: payment.id }, data: {
      providerPaymentId: input.providerPaymentId ?? previous.providerPaymentId,
      payloadSnapshot: { ...(previous.payloadSnapshot as object ?? {}), providerStatus: input.providerStatus ?? null } as Prisma.InputJsonValue,
      status: input.status, refundedAt: input.status === "REFUNDED" ? previous.refundedAt ?? new Date() : previous.refundedAt
    } });
    return true;
  });

  if (changed) await recordAdminAction({
    action: "payment_status_updated",
    entityType: "Payment",
    entityId: payment.id,
    afterData: {
      providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId ?? null,
      providerStatus: input.providerStatus ?? null,
      status: input.status
    }
  });

  return {
    paymentId: payment.id,
    status: input.status
  };
}

function getSupportLabel(supportType: SupportType): string {
  if (supportType === "BASIC") {
    return "Базовое сопровождение";
  }

  if (supportType === "EXTENDED") {
    return "Расширенное сопровождение";
  }

  return "Без сопровождения";
}

function describeBundle(template: RouterTemplateLike): string {
  const parts: string[] = [];

  if (template.accessEnabled) {
    parts.push("Расширенный доступ");
  }

  if (template.supportType !== "NONE") {
    parts.push(getSupportLabel(template.supportType));
  }

  return parts.length ? parts.join(" + ") : "Пакет не выбран";
}

function calculateBundlePrice(settings: SettingMap, template: RouterTemplateLike): number {
  let total = 0;

  if (template.accessEnabled) {
    total += getNumericSetting(settings, "extended_access_price", 999);
  }

  if (template.supportType === "BASIC") {
    total += getNumericSetting(settings, "basic_support_price", 999);
  }

  if (template.supportType === "EXTENDED") {
    total += getNumericSetting(settings, "extended_support_price", 999);
  }

  return total;
}

function getRecommendedTemplate(): RouterTemplateLike {
  return {
    accessEnabled: true,
    supportType: "EXTENDED"
  };
}

function buildPaymentUrl(fallbackUrl: string, entity: "order" | "renewal", id: string): string {
  const separator = fallbackUrl.includes("?") ? "&" : "?";
  return `${fallbackUrl}${separator}start=${entity}_${id}`;
}

async function ensureAdminActorUser() {
  const adminEmail = `admin+${config.ADMIN_USERNAME}@foxpoint.local`;
  const existing = await prisma.authIdentity.findFirst({
    where: {
      provider: "EMAIL",
      email: adminEmail
    },
    include: {
      user: true
    }
  });

  if (existing?.user) {
    return existing.user;
  }

  return prisma.user.create({
    data: {
      name: `Admin ${config.ADMIN_USERNAME}`,
      status: "ACTIVE",
      identities: {
        create: {
          provider: "EMAIL",
          providerUserId: adminEmail,
          email: adminEmail,
          verifiedAt: new Date()
        }
      }
    }
  });
}

async function recordAdminAction(input: {
  action: string;
  entityId: string;
  entityType: string;
  beforeData?: Prisma.InputJsonValue;
  afterData?: Prisma.InputJsonValue;
}) {
  const adminUser = await ensureAdminActorUser();

  await prisma.adminAuditLog.create({
    data: {
      adminId: adminUser.id,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeData: input.beforeData,
      afterData: input.afterData
    }
  });
}

function getPrimaryEmail(identities: Array<{ provider: string; email: string | null }>): string | null {
  return identities.find((identity) => identity.provider === "EMAIL" && identity.email)?.email ?? null;
}

function getTelegramIdentity(
  identities: Array<{ provider: string; providerUserId: string; email?: string | null }>
): string | null {
  const telegramIdentity = identities.find((identity) => identity.provider === "TELEGRAM");
  if (!telegramIdentity) {
    return null;
  }

  if (telegramIdentity.email) {
    return `@${telegramIdentity.email.replace(/^@+/, "")}`;
  }

  return /^\d+$/.test(telegramIdentity.providerUserId)
    ? `Telegram ID ${telegramIdentity.providerUserId}`
    : `@${telegramIdentity.providerUserId}`;
}

function getLocalIdentity(
  identities: Array<{ provider: string; providerUserId: string }>
): string | null {
  return identities.find((identity) => identity.provider === "LOCAL")?.providerUserId ?? null;
}

type AdminUserWithRelations = {
  clientCode: string | null;
  city: string | null;
  phone: string | null;
  contactTelegram: string | null;
  id: string;
  name: string | null;
  status: UserStatus;
  createdAt: Date;
  lastActivityAt: Date | null;
  balance: Prisma.Decimal | number | string;
  routers: Array<{ id: string }>;
  identities: Array<{
    provider: string;
    providerUserId: string;
    email: string | null;
  }>;
};

function mapAdminUserRecord(user: AdminUserWithRelations) {
  const telegramIdentity = user.identities.find((identity) => identity.provider === "TELEGRAM");

  return {
    id: user.id,
    clientCode: user.clientCode,
    name: user.name,
    phone: user.phone,
    city: user.city,
    email: getPrimaryEmail(user.identities),
    telegram: getTelegramIdentity(user.identities) ?? user.contactTelegram,
    telegramUsername: telegramIdentity?.email?.replace(/^@+/, "") ?? user.contactTelegram,
    hasTelegramIdentity: Boolean(telegramIdentity),
    status: user.status,
    balance: toNumber(user.balance),
    balanceLabel: formatMoney(toNumber(user.balance)),
    routerCount: user.routers.length,
    referralCode: buildReferralCode(user.id),
    createdAt: user.createdAt.toISOString(),
    lastActivityAt: user.lastActivityAt?.toISOString() ?? null
  };
}

function normalizeAdminClientQuery(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function buildAdminClientSearchWhere(query: string): Prisma.UserWhereInput | undefined {
  const normalized = normalizeAdminClientQuery(query);

  if (!normalized) {
    return undefined;
  }

  return {
    OR: [
      { phone: { contains: normalized, mode: "insensitive" } },
      { city: { contains: normalized, mode: "insensitive" } },
      { contactTelegram: { contains: normalized, mode: "insensitive" } },
      { routers: { some: { OR: [
        { routerCode: { contains: normalized, mode: "insensitive" } },
        { displayName: { contains: normalized, mode: "insensitive" } }
      ] } } },
      {
        clientCode: {
          contains: normalized,
          mode: "insensitive"
        }
      },
      {
        id: {
          contains: normalized,
          mode: "insensitive"
        }
      },
      {
        name: {
          contains: normalized,
          mode: "insensitive"
        }
      },
      {
        identities: {
          some: {
            OR: [
              {
                email: {
                  contains: normalized,
                  mode: "insensitive"
                }
              },
              {
                providerUserId: {
                  contains: normalized,
                  mode: "insensitive"
                }
              }
            ]
          }
        }
      }
    ]
  };
}

export async function buildSiteSnapshot() {
  const [links, settings] = await Promise.all([getPublicSettingLinks(), getSettingMap()]);
  const routerPrice = getNumericSetting(settings, "router_price", 4499);
  const setupPrice = getNumericSetting(settings, "setup_price", 4999);
  const recommendedTemplate = getRecommendedTemplate();
  const recommendedPrice = calculateBundlePrice(settings, recommendedTemplate);
  const trialPeriodDays = getNumericSetting(settings, "trial_period_days", 14);
  const referralBonus = getNumericSetting(settings, "referral_bonus_referrer", 1000);
  const referralPercent = getNumericSetting(settings, "referral_subscription_percent", 10);

  return {
    product: "Интернет, как раньше",
    tagline: "Готовые настроенные роутеры, личный кабинет, продление услуг и поддержка в одном месте.",
    links,
    trialPeriodDays,
    orderOffer: {
      routerPrice,
      routerPriceLabel: formatMoney(routerPrice),
      setupPrice,
      setupPriceLabel: formatMoney(setupPrice),
      totalPrice: routerPrice + setupPrice,
      totalPriceLabel: formatMoney(routerPrice + setupPrice)
    },
    subscriptionOffer: {
      periodDays: SUBSCRIPTION_MONTH_DAYS,
      extendedAccessPrice: getNumericSetting(settings, "extended_access_price", 999),
      basicSupportPrice: getNumericSetting(settings, "basic_support_price", 999),
      extendedSupportPrice: getNumericSetting(settings, "extended_support_price", 999),
      recommendedPrice,
      recommendedPriceLabel: formatMoney(recommendedPrice),
      recommendedPackage: describeBundle(recommendedTemplate)
    },
    referralOffer: {
      signupBonus: referralBonus,
      signupBonusLabel: formatMoney(referralBonus),
      subscriptionPercent: referralPercent
    },
    corePrinciples: [
      "Один клиент может иметь несколько роутеров и разные пакеты услуг.",
      "Продление всегда привязано к конкретному устройству, а не к аккаунту в целом.",
      "Сайт и Telegram используют общий backend и показывают одинаковые данные по срокам и оплатам."
    ],
    journey: [
      "Открыть сайт или Telegram и выбрать удобный способ входа.",
      "Зайти в личный кабинет, увидеть привязанные роутеры, услуги и сроки.",
      "Продлить пакет, заказать роутер или написать в поддержку без ручного поиска менеджера."
    ]
  };
}

export async function buildClientOverview(input: { currentSessionId?: string; liveCheck?: boolean; userId: string }) {
  await ensureClientAndRouterCodes();
  const [links, settings, user, openTwoFactorRequest, openDeletionRequest, clientSessions] = await Promise.all([
    getPublicSettingLinks(),
    getSettingMap(),
    prisma.user.findUnique({
      where: {
        id: input.userId
      },
      include: {
        identities: true,
        routers: {
          include: {
            payments: {
              orderBy: {
                createdAt: "desc"
              },
              take: 5
            },
            subscriptions: {
              orderBy: {
                endAt: "desc"
              }
            },
            template: true,
            trial: true,
            tickets: {
              select: {
                id: true,
                number: true,
                category: true,
                status: true,
                updatedAt: true
              },
              orderBy: {
                updatedAt: "desc"
              },
              take: 3
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        },
        orders: {
          orderBy: {
            createdAt: "desc"
          },
          take: 5
        },
        tickets: {
          select: {
            id: true,
            number: true,
            category: true,
            description: true,
            status: true,
            routerId: true,
            adminComment: true,
            adminCommentUpdatedAt: true,
            createdAt: true,
            updatedAt: true,
            messages: {
              select: {
                id: true,
                authorRole: true,
                body: true,
                createdAt: true
              },
              orderBy: {
                createdAt: "asc"
              }
            }
          },
          orderBy: {
            updatedAt: "desc"
          },
          take: 5
        },
        payments: {
          include: {
            router: {
              select: {
                displayName: true
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 8
        },
        rewards: {
          orderBy: {
            createdAt: "desc"
          },
          take: 8
        },
        referralsMade: {
          include: {
            referred: {
              select: {
                createdAt: true,
                id: true
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    }),
    prisma.supportTicket.findFirst({
      where: {
        userId: input.userId,
        category: "2FA",
        status: {
          in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"]
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    }),
    prisma.supportTicket.findFirst({
      where: {
        userId: input.userId,
        category: "Удаление аккаунта",
        status: {
          in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"]
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    }),
    listClientSessionsForUser({
      userId: input.userId,
      currentSessionId: input.currentSessionId
    })
  ]);

  if (!user) {
    throw new Error("User not found.");
  }

  const notificationFeed = await getClientNotificationFeed(input.userId);
  const recommendedTemplate = getRecommendedTemplate();
  const recommendedPrice = calculateBundlePrice(settings, recommendedTemplate);
  const localLogin = getLocalIdentity(user.identities);
  const liveCheckEntries: Array<readonly [string, RouterLiveCheckResult]> = await Promise.all(
    user.routers.map(async (router): Promise<readonly [string, RouterLiveCheckResult]> => [
      router.id,
      input.liveCheck ? await runRouterLiveCheck(router.monitorHost, router.monitorPort ?? 443) : { checkedAt: null, reachable: null }
    ])
  );
  const liveCheckByRouterId = new Map<string, RouterLiveCheckResult>(liveCheckEntries);
  const routerCards = user.routers.map((router) => {
    const currentSubscription = router.serviceTariff === "Самостоятельно" ? null : pickCurrentSubscription(router.subscriptions);
    const savedTemplate = router.template ?? currentSubscription ?? {
      accessEnabled: false,
      supportType: "NONE" as const
    };
    const nextPrice = router.serviceTariff === "Самостоятельно" ? 0 : router.template
      ? toNumber(router.template.priceOverride ?? router.template.currentPrice) : calculateBundlePrice(settings, savedTemplate);
    const liveCheck = liveCheckByRouterId.get(router.id) ?? {
      checkedAt: null,
      reachable: null
    };

    return {
      id: router.id,
      routerCode: router.routerCode,
      displayName: router.displayName,
      model: router.model,
      serialNumber: router.serialNumber,
      configurationType: router.configurationType,
      status: router.status,
      // Internal notes and network addresses never leave the admin interface.
      adminNote: null,
      currentPackage: router.serviceTariff ?? describeBundle(savedTemplate),
      lastCheckAt: liveCheck.checkedAt,
      lastCheckReachable: liveCheck.reachable,
      currentSubscription: currentSubscription
        ? {
            accessEnabled: currentSubscription.accessEnabled,
            supportType: currentSubscription.supportType,
            status: getEffectiveSubscriptionStatus(currentSubscription) ?? currentSubscription.status,
            startAt: currentSubscription.startAt?.toISOString() ?? null,
            endAt: currentSubscription.endAt?.toISOString() ?? null,
            daysRemaining: getDaysRemaining(currentSubscription.endAt),
            price: toNumber(currentSubscription.priceSnapshot),
            priceLabel: formatMoney(toNumber(currentSubscription.priceSnapshot)),
            pendingActivation: currentSubscription.pendingActivation
          }
        : null,
      savedTemplate: {
        accessEnabled: savedTemplate.accessEnabled,
        supportType: savedTemplate.supportType,
        label: router.serviceTariff ?? describeBundle(savedTemplate),
        nextPrice,
        nextPriceLabel: formatMoney(nextPrice)
      },
      recentPayments: router.payments.map((payment) => ({
        id: payment.id,
        status: payment.status,
        amount: toNumber(payment.amount),
        amountLabel: formatMoney(toNumber(payment.amount)),
        createdAt: payment.createdAt.toISOString()
      })),
      recentTickets: router.tickets.map((ticket) => ({
        id: ticket.id,
        number: ticket.number,
        category: ticket.category,
        status: ticket.status,
        updatedAt: ticket.updatedAt.toISOString()
      })),
      trial: router.serviceTariff !== "Самостоятельно" && router.trial
        ? {
            used: router.trial.used,
            startAt: router.trial.startAt?.toISOString() ?? null,
            endAt: router.trial.endAt?.toISOString() ?? null,
            daysRemaining: getDaysRemaining(router.trial.endAt)
          }
        : null
    };
  });

  const availableRewards = user.rewards
    .filter((reward) => reward.status === "AVAILABLE")
    .reduce((sum, reward) => sum + toNumber(reward.amount), 0);
  const pendingRewards = user.rewards
    .filter((reward) => reward.status === "PENDING")
    .reduce((sum, reward) => sum + toNumber(reward.amount), 0);

  return {
    product: "Интернет, как раньше",
    profile: {
      id: user.id,
      clientCode: user.clientCode,
      name: user.publicName ?? (user.routers.some(r => r.importKey) ? user.clientCode ?? "Клиент FoxPoint" : user.name ?? "Клиент FoxPoint"),
      email: getPrimaryEmail(user.identities),
      telegram: getTelegramIdentity(user.identities),
      localLogin,
      createdAt: user.createdAt.toISOString(),
      lastActivityAt: user.lastActivityAt?.toISOString() ?? null,
      notificationFeedSeenAt: user.notificationFeedSeenAt?.toISOString() ?? null,
      notificationFeedClearedAt: user.notificationFeedClearedAt?.toISOString() ?? null,
      status: user.status,
      balance: toNumber(user.balance),
      balanceLabel: formatMoney(toNumber(user.balance)),
      referralCode: buildReferralCode(user.id),
      referralLink: `${links.appUrl}/login?ref=${encodeURIComponent(buildReferralCode(user.id))}`,
      hasOpenTwoFactorRequest: Boolean(openTwoFactorRequest),
      hasOpenDeletionRequest: Boolean(openDeletionRequest)
    },
    sessions: clientSessions,
    links: {
      apiUrl: links.apiUrl,
      appUrl: links.appUrl,
      support: links.support,
      telegramBot: links.telegramBot,
      telegramChannel: links.telegramChannel
    },
    paymentMethods: getEnabledPaymentMethods(settings),
    stats: {
      routerCount: user.routers.length,
      activeRouterCount: user.routers.filter((router) => router.status === "ACTIVE").length,
      openTicketCount: user.tickets.filter((ticket) => ticket.status !== "CLOSED").length,
      unreadNotificationCount: notificationFeed.unreadCount
    },
    catalog: {
      periodDays: SUBSCRIPTION_MONTH_DAYS,
      extendedAccessPrice: getNumericSetting(settings, "extended_access_price", 999),
      basicSupportPrice: getNumericSetting(settings, "basic_support_price", 999),
      extendedSupportPrice: getNumericSetting(settings, "extended_support_price", 999),
      recommendedPrice,
      recommendedPriceLabel: formatMoney(recommendedPrice),
      recommendedPackage: describeBundle(recommendedTemplate)
    },
    orderOffer: {
      routerPrice: getNumericSetting(settings, "router_price", 4499),
      routerPriceLabel: formatMoney(getNumericSetting(settings, "router_price", 4499)),
      setupPrice: getNumericSetting(settings, "setup_price", 4999),
      setupPriceLabel: formatMoney(getNumericSetting(settings, "setup_price", 4999)),
      totalPrice:
        getNumericSetting(settings, "router_price", 4499) + getNumericSetting(settings, "setup_price", 4999),
      totalPriceLabel: formatMoney(
        getNumericSetting(settings, "router_price", 4499) + getNumericSetting(settings, "setup_price", 4999)
      )
    },
    routers: routerCards,
    orders: user.orders.map((order) => ({
      id: order.id,
      status: order.status,
      totalPrice: toNumber(order.totalPrice),
      totalPriceLabel: formatMoney(toNumber(order.totalPrice)),
      trackingNumber: order.trackingNumber,
      createdAt: order.createdAt.toISOString(),
      receivedAt: order.receivedAt?.toISOString() ?? null
    })),
    tickets: user.tickets.map((ticket) => ({
      id: ticket.id,
      number: ticket.number,
      category: ticket.category,
      description: ticket.description,
      status: ticket.status,
      routerId: ticket.routerId,
      adminComment: ticket.adminComment,
      adminCommentUpdatedAt: ticket.adminCommentUpdatedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      messages: mapSupportTicketMessages({
        adminComment: ticket.adminComment,
        adminCommentUpdatedAt: ticket.adminCommentUpdatedAt ?? null,
        createdAt: ticket.createdAt,
        description: ticket.description,
        id: ticket.id,
        messages: ticket.messages
      })
    })),
    payments: user.payments.map((payment) => ({
      id: payment.id,
      daysAdded: payment.daysAdded,
      amount: toNumber(payment.amount),
      amountLabel: formatMoney(toNumber(payment.amount)),
      provider: payment.provider,
      providerLabel: getPaymentProviderLabel(payment.provider),
      status: payment.status,
      routerName: payment.router?.displayName ?? null,
      createdAt: payment.createdAt.toISOString(),
      paidAt: payment.paidAt?.toISOString() ?? null,
      paymentUrl: payment.paymentUrl
    })),
    referrals: {
      invitedCount: user.referralsMade.length,
      availableRewards,
      availableRewardsLabel: formatMoney(availableRewards),
      pendingRewards,
      pendingRewardsLabel: formatMoney(pendingRewards),
      items: user.referralsMade.map((referral) => ({
        id: referral.id,
        referredUserId: referral.referredUserId,
        createdAt: referral.createdAt.toISOString(),
        referredCreatedAt: referral.referred.createdAt.toISOString()
      }))
    },
    rewards: user.rewards.map((reward) => ({
      id: reward.id,
      sourceType: reward.sourceType,
      sourceId: reward.sourceId,
      amount: toNumber(reward.amount),
      amountLabel: formatMoney(toNumber(reward.amount)),
      status: reward.status,
      createdAt: reward.createdAt.toISOString(),
      availableAt: reward.availableAt?.toISOString() ?? null
    })),
    notifications: notificationFeed.notifications,
    notificationFeedAsOf: notificationFeed.asOf,
    notificationFeedHasMore: notificationFeed.hasMore
  };
}

export async function createRouterOrderForUser(input: {
  provider?: string | null;
  userId: string;
}) {
  const [links, settings] = await Promise.all([getPublicSettingLinks(), getSettingMap()]);
  const routerPrice = getNumericSetting(settings, "router_price", 4499);
  const setupPrice = getNumericSetting(settings, "setup_price", 4999);
  const totalPrice = routerPrice + setupPrice;
  const provider = resolveRequestedPaymentProvider(settings, input.provider);
  const description = "Заказ роутера FoxPoint";

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.routerOrder.create({
      data: {
        userId: input.userId,
        routerPrice,
        setupPrice,
        totalPrice,
        status: "WAITING_PAYMENT"
      }
    });

    const payment = await tx.payment.create({
      data: {
        userId: input.userId,
        orderId: order.id,
        provider,
        amount: totalPrice,
        status: "CREATED",
        payloadSnapshot: {
          description,
          type: "router_order",
          orderId: order.id
        }
      }
    });

    return {
      order,
      payment
    };
  });

  let paymentUrl = buildPaymentUrl(links.support, "order", result.order.id);
  let providerPaymentId: string | null = null;
  let paymentStatus: PaymentStatus = "PENDING";
  let payloadSnapshot = {
    description,
    orderId: result.order.id,
    type: "router_order" as const
  } as unknown as Prisma.InputJsonValue;

  if (provider === "platega") {
    const transaction = await createPlategaTransaction({
      amount: totalPrice,
      description,
      links,
      paymentId: result.payment.id,
      settings,
      userId: input.userId
    });
    paymentUrl = transaction.paymentUrl;
    providerPaymentId = transaction.providerPaymentId;
  } else if (provider === "yookassa") {
    const transaction = await createYooKassaTransaction({
      amount: totalPrice,
      description,
      links,
      metadata: {
        foxpoint_order_id: result.order.id,
        foxpoint_payment_type: "router_order",
        foxpoint_user_id: input.userId
      },
      paymentId: result.payment.id,
      settings
    });
    paymentUrl = transaction.paymentUrl;
    providerPaymentId = transaction.providerPaymentId;
  } else if (provider === "yoomoney") {
    paymentUrl = buildYooMoneyCheckoutUrl(links, result.payment.id);
    payloadSnapshot = {
      ...(payloadSnapshot as Record<string, unknown>),
      paymentLabel: buildPaymentLabel(result.payment.id),
      successUrl: buildCabinetPaymentSuccessUrl(links)
    } as unknown as Prisma.InputJsonValue;
  }

  await prisma.payment.update({
    where: {
      id: result.payment.id
    },
    data: {
      paymentUrl,
      payloadSnapshot,
      providerPaymentId,
      status: paymentStatus
    }
  });

  return {
    orderId: result.order.id,
    paymentId: result.payment.id,
    paymentUrl,
    provider,
    providerLabel: getPaymentProviderLabel(provider),
    totalPrice,
    totalPriceLabel: formatMoney(totalPrice)
  };
}

export async function getClientSupportTicketForUser(input: { userId: string; ticketId: string }) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: input.ticketId, userId: input.userId },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });
  if (!ticket) return null;
  return {
    id: ticket.id, number: ticket.number, category: ticket.category, description: ticket.description,
    status: ticket.status, routerId: ticket.routerId, adminComment: ticket.adminComment,
    adminCommentUpdatedAt: ticket.adminCommentUpdatedAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(), updatedAt: ticket.updatedAt.toISOString(),
    messages: mapSupportTicketMessages({ ...ticket, adminCommentUpdatedAt: ticket.adminCommentUpdatedAt ?? null })
  };
}

export async function createSupportTicketForUser(input: {
  category: string;
  description: string;
  routerId?: string | null;
  userId: string;
}) {
  if (input.routerId) {
    const router = await prisma.router.findFirst({
      where: {
        id: input.routerId,
        ownerUserId: input.userId
      }
    });

    if (!router) {
      throw new Error("Роутер не найден или не принадлежит клиенту.");
    }
  }

  const description = input.description.trim();
  const ticket = await prisma.$transaction(async (tx) => {
    const createdTicket = await tx.supportTicket.create({
      data: {
        userId: input.userId,
        routerId: input.routerId ?? null,
        category: input.category.trim(),
        description,
        status: "IN_PROGRESS",
        messages: {
          create: {
            authorRole: "CLIENT",
            body: description
          }
        }
      }
    });

    const automaticReply = await tx.supportTicketMessage.create({
      data: {
        authorRole: "ADMIN",
        body: "Ожидайте оператора.",
        ticketId: createdTicket.id
      }
    });

    await createClientNotification(tx, { userId: input.userId, type: "SUPPORT_REPLY", relatedType: "SupportTicketMessage", relatedId: automaticReply.id,
      title: `Ответ поддержки · #${createdTicket.number}`, detail: "Ожидайте оператора.", href: `/cabinet/support?ticket=${createdTicket.id}#ticket-${createdTicket.id}` });

    return createdTicket;
  });

  return {
    ticketId: ticket.id
  };
}

export async function createPublicSupportTicket(input: { routerCode: string; description: string; contact: string }) {
  const code = input.routerCode.trim().toUpperCase();
  const router = await prisma.router.findFirst({ where: { OR: [{ routerCode: code }, { codeAliases: { has: code } }] } });
  if (!router || router.status === "DISABLED") throw new Error("Проверьте код роутера на табличке.");
  const description = input.description.trim();
  const ticket = await prisma.supportTicket.create({ data: {
    userId: router.ownerUserId, routerId: router.id, category: "Поддержка по QR", description,
    guestContact: input.contact.trim(), status: "OPEN",
    messages: { create: { authorRole: "CLIENT", body: description } }
  } });
  return { number: ticket.number };
}

export async function addAdminSubscriptionPayment(input: {
  subscriptionId: string; amount: number; days: number; requestKey: string;
  paidAt?: string; method?: string; reason?: string;
}) {
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1000000 || !Number.isInteger(input.days) || input.days < 1 || input.days > 3650) throw new Error("Укажите сумму от 0,01 до 1 000 000 ₽ и от 1 до 3650 дней.");
  const paidAt = moscowDate(input.paidAt);
  const actor = await ensureAdminActorUser();
  const result = await prisma.$transaction(async (tx) => {
    const initial = await tx.subscription.findUnique({ where: { id: input.subscriptionId } });
    if (!initial) throw new Error("Подписка не найдена.");
    await tx.$queryRaw`SELECT "id" FROM "Router" WHERE "id" = ${initial.routerId} FOR UPDATE`;
    const importKey = `admin-renewal:${input.requestKey}`;
    const existing = await tx.payment.findUnique({ where: { importKey } });
    if (existing) {
      const previous = existing.payloadSnapshot as { subscriptionId?: string } | null;
      if (previous?.subscriptionId !== input.subscriptionId || Number(existing.amount) !== input.amount || existing.daysAdded !== input.days) throw new Error("Ключ оплаты уже использован для другой операции.");
      return { paymentId: existing.id, repeated: true };
    }
    const subscription = await tx.subscription.findUniqueOrThrow({ where: { id: input.subscriptionId } });
    const router = await tx.router.findUniqueOrThrow({ where: { id: subscription.routerId }, include: { template: true, owner:true } });
    if(router.archivedAt || router.owner.archivedAt || subscription.status === "CANCELLED")throw new Error("Для архивной или отменённой услуги сначала выполните восстановление.");
    if (router.serviceTariff === "Самостоятельно") throw new Error("Самостоятельное обслуживание не имеет подписки.");
    if (subscription.pendingActivation && !subscription.pendingDays && subscription.endAt) throw new Error("Сначала сверить дни старой подписки, ожидающей активации. Сохранённый срок не изменён.");
    const periodDays = router.serviceTariff === "Индивидуальный" ? router.template?.periodDays ?? 30 : 30;
    const periodPrice = Number((input.amount * periodDays / input.days).toFixed(2));
    const pendingActivation = subscription.pendingActivation || (!subscription.startAt && !subscription.endAt);
    const endAt = pendingActivation ? null : extendSubscriptionEnd(subscription.endAt, input.days, paidAt);
    const payment = await tx.payment.create({ data: {
      importKey, userId: router.ownerUserId, routerId: router.id, amount: input.amount,
      daysAdded: input.days, provider: "admin_manual", status: "PAID", paidAt,
      payloadSnapshot: { type: "subscription_renewal", subscriptionId: subscription.id, accessEnabled: subscription.accessEnabled,
        supportType: subscription.supportType, tariff: router.serviceTariff, periodPrice, periodDays, days: input.days,
        method: input.method?.trim() || "Ручная регистрация", reason: input.reason?.trim() || "Регистрация полученной оплаты" }
    } });
    await tx.subscription.update({ where: { id: subscription.id }, data: {
      startAt: pendingActivation ? null : subscription.startAt ?? paidAt, endAt, lastPaymentId: payment.id, pendingActivation,
      pendingDays: pendingActivation ? subscription.pendingDays + input.days : 0,
      priceSnapshot: periodPrice,
      status: pendingActivation ? "PENDING_ACTIVATION" : "ACTIVE"
    } });
    await createClientNotification(tx, { userId: router.ownerUserId, type: "PAYMENT_PAID", relatedType: "Payment", relatedId: payment.id,
      title: "Оплата подтверждена", detail: `${formatMoney(input.amount)} · ${router.displayName} · продление на ${input.days} дней.`, href: "/cabinet/payments" });
    await tx.adminAuditLog.create({ data: { adminId: actor.id, action: "subscription_payment_added", entityType: "Payment", entityId: payment.id,
      beforeData: JSON.parse(JSON.stringify(subscription)), afterData: { subscriptionId: subscription.id, routerId: router.id, amount: input.amount, daysAdded: input.days, paidAt: paidAt.toISOString(), method: input.method ?? "Ручная регистрация", reason: input.reason ?? "Регистрация полученной оплаты", endAt: endAt?.toISOString() ?? null } } });
    return { paymentId: payment.id, repeated: false };
  });
  return result;
}

export async function addClientSupportTicketMessageForUser(input: {
  body: string;
  ticketId: string;
  userId: string;
}) {
  const ticket = await prisma.supportTicket.findFirst({
    where: {
      id: input.ticketId,
      userId: input.userId
    }
  });

  if (!ticket) {
    throw new Error("Обращение не найдено.");
  }

  return appendSupportTicketMessage({
    authorRole: "CLIENT",
    body: input.body,
    ticketId: input.ticketId
  });
}

export async function addAdminSupportTicketMessage(input: {
  body: string;
  ticketId: string;
}) {
  return appendSupportTicketMessage({
    authorRole: "ADMIN",
    body: input.body,
    ticketId: input.ticketId
  });
}

export async function createProfileRequestForUser(input: {
  kind: "DELETE_ACCOUNT" | "TWO_FACTOR";
  userId: string;
}) {
  const requestMeta =
    input.kind === "TWO_FACTOR"
      ? {
          action: "two_factor_request_created",
          category: "2FA",
          description: "Клиент запросил подключение или настройку двухфакторной защиты через личный кабинет."
        }
      : {
          action: "account_delete_request_created",
          category: "Удаление аккаунта",
          description: "Клиент запросил удаление аккаунта через личный кабинет."
        };

  const existingRequest = await prisma.supportTicket.findFirst({
    where: {
      userId: input.userId,
      category: requestMeta.category,
      status: {
        in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"]
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (existingRequest) {
    return {
      created: false,
      ticketId: existingRequest.id
    };
  }

  const ticket = await prisma.supportTicket.create({
    data: {
      userId: input.userId,
      category: requestMeta.category,
      description: requestMeta.description,
      messages: {
        create: {
          authorRole: "CLIENT",
          body: requestMeta.description
        }
      }
    }
  });

  await recordAdminAction({
    action: requestMeta.action,
    entityType: "SupportTicket",
    entityId: ticket.id,
    afterData: {
      userId: input.userId,
      category: requestMeta.category
    }
  });

  return {
    created: true,
    ticketId: ticket.id
  };
}

export async function attachEmailForUser(input: {
  email: string;
  userId: string;
}) {
  const user = await prisma.user.findUnique({
    where: {
      id: input.userId
    },
    include: {
      identities: true
    }
  });

  if (!user) {
    throw new Error("Клиент не найден.");
  }

  if (getPrimaryEmail(user.identities)) {
    throw new Error("Email уже привязан к этому аккаунту.");
  }

  const identity = await bindEmailIdentityForUser({
    userId: input.userId,
    email: input.email
  });

  return {
    email: identity.email ?? input.email
  };
}

export async function saveLocalCredentialsForUser(input: {
  login: string;
  password: string;
  userId: string;
}) {
  const identity = await upsertLocalCredentialsForUser({
    userId: input.userId,
    login: input.login,
    password: input.password
  });

  return {
    login: normalizeClientLogin(identity.providerUserId)
  };
}

export async function updateRouterTemplateForUser(input: {
  accessEnabled: boolean;
  routerId: string;
  supportType: SupportType;
  userId: string;
}) {
  const settings = await getSettingMap();
  const router = await prisma.router.findFirst({
    where: {
      id: input.routerId,
      ownerUserId: input.userId
    },
    include: { template: true }
  });

  if (!router) {
    throw new Error("Роутер не найден.");
  }

  const samePackage = router.template?.accessEnabled === input.accessEnabled && router.template?.supportType === input.supportType;
  const priceOverride = samePackage ? router.template?.priceOverride ?? null : null;
  const nextPrice = priceOverride != null ? toNumber(priceOverride) : calculateBundlePrice(settings, input);
  await prisma.subscriptionTemplate.upsert({
    where: {
      routerId: input.routerId
    },
    update: {
      accessEnabled: input.accessEnabled,
      supportType: input.supportType,
      periodDays: SUBSCRIPTION_MONTH_DAYS,
      currentPrice: nextPrice,
      priceOverride
    },
    create: {
      routerId: input.routerId,
      accessEnabled: input.accessEnabled,
      supportType: input.supportType,
      periodDays: SUBSCRIPTION_MONTH_DAYS,
      currentPrice: nextPrice
    }
  });

  if (!samePackage) await prisma.router.update({ where: { id: input.routerId }, data: { serviceTariff: null } });

  return {
    routerId: input.routerId,
    nextPrice,
    nextPriceLabel: formatMoney(nextPrice),
    bundleLabel: describeBundle(input)
  };
}

export async function createRenewalPaymentForUser(input: {
  provider?: string | null;
  routerId: string;
  userId: string;
}) {
  const [links, settings, router] = await Promise.all([
    getPublicSettingLinks(),
    getSettingMap(),
    prisma.router.findFirst({
      where: {
        id: input.routerId,
        ownerUserId: input.userId
      },
      include: {
        subscriptions: {
          orderBy: {
            endAt: "desc"
          }
        },
        template: true
      }
    })
  ]);

  if (!router) {
    throw new Error("Роутер не найден.");
  }
  if (router.serviceTariff === "Самостоятельно") throw new Error("Самостоятельное обслуживание не требует продления.");

  const activeTemplate =
    router.template ??
    router.subscriptions.find((subscription) => subscription.status === "ACTIVE") ?? {
      accessEnabled: false,
      supportType: "NONE" as const
    };
  const amount = router.template ? toNumber(router.template.priceOverride ?? router.template.currentPrice) : calculateBundlePrice(settings, activeTemplate);
  const provider = resolveRequestedPaymentProvider(settings, input.provider);
  const description = `Продление обслуживания: ${router.displayName}`;

  if (amount <= 0) {
    throw new Error("Сначала выберите пакет для продления.");
  }

  const sameService = router.subscriptions.find(s => s.accessEnabled === activeTemplate.accessEnabled && s.supportType === activeTemplate.supportType);
  const requiresActivation = sameService?.pendingActivation || !sameService?.startAt;
  const purchasedDays = router.serviceTariff === "Индивидуальный" ? router.template?.periodDays ?? 30 : 30;

  const payment = await prisma.payment.create({
    data: {
      userId: input.userId,
      routerId: input.routerId,
      provider,
      amount,
      daysAdded: purchasedDays,
      status: "CREATED",
      payloadSnapshot: {
        description,
        type: "subscription_renewal",
        routerId: input.routerId,
        accessEnabled: activeTemplate.accessEnabled,
        supportType: activeTemplate.supportType,
        requiresActivation
        ,periodPrice: amount, periodDays: purchasedDays, tariff: router.serviceTariff
      }
    }
  });

  let paymentUrl = buildPaymentUrl(links.support, "renewal", input.routerId);
  let providerPaymentId: string | null = null;
  let payloadSnapshot = {
    periodPrice: amount, periodDays: purchasedDays, tariff: router.serviceTariff,
    accessEnabled: activeTemplate.accessEnabled,
    description,
    requiresActivation,
    routerId: input.routerId,
    supportType: activeTemplate.supportType,
    type: "subscription_renewal" as const
  } as unknown as Prisma.InputJsonValue;

  if (provider === "platega") {
    const transaction = await createPlategaTransaction({
      amount,
      description,
      links,
      paymentId: payment.id,
      settings,
      userId: input.userId
    });
    paymentUrl = transaction.paymentUrl;
    providerPaymentId = transaction.providerPaymentId;
  } else if (provider === "yookassa") {
    const transaction = await createYooKassaTransaction({
      amount,
      description,
      links,
      metadata: {
        foxpoint_payment_type: "subscription_renewal",
        foxpoint_router_id: input.routerId,
        foxpoint_user_id: input.userId
      },
      paymentId: payment.id,
      settings
    });
    paymentUrl = transaction.paymentUrl;
    providerPaymentId = transaction.providerPaymentId;
  } else if (provider === "yoomoney") {
    paymentUrl = buildYooMoneyCheckoutUrl(links, payment.id);
    payloadSnapshot = {
      ...(payloadSnapshot as Record<string, unknown>),
      paymentLabel: buildPaymentLabel(payment.id),
      successUrl: buildCabinetPaymentSuccessUrl(links)
    } as unknown as Prisma.InputJsonValue;
  }

  await prisma.payment.update({
    where: {
      id: payment.id
    },
    data: {
      paymentUrl,
      payloadSnapshot,
      providerPaymentId,
      status: "PENDING"
    }
  });

  return {
    paymentId: payment.id,
    paymentUrl,
    amount,
    amountLabel: formatMoney(amount),
    provider,
    providerLabel: getPaymentProviderLabel(provider),
    requiresActivation
  };
}

export async function buildYooMoneyCheckoutHtml(paymentId: string) {
  const [links, settings, payment] = await Promise.all([
    getPublicSettingLinks(),
    getSettingMap(),
    prisma.payment.findUnique({
      where: {
        id: paymentId
      }
    })
  ]);

  if (!payment || payment.provider !== "yoomoney") {
    throw new Error("Страница оплаты не найдена.");
  }

  const snapshot = (payment.payloadSnapshot ?? {}) as {
    description?: string;
    paymentLabel?: string;
    successUrl?: string;
  };
  const receiver = ensureConfiguredSetting(
    settings,
    "yoomoney_receiver",
    "ЮMoney кошелек",
    "41001xxxxxxxxxxxx"
  );
  const description = snapshot.description ?? "Оплата FoxPoint";
  const successUrl = snapshot.successUrl ?? buildCabinetPaymentSuccessUrl(links);
  const paymentLabel = snapshot.paymentLabel ?? buildPaymentLabel(payment.id);
  const amount = formatDecimalAmount(toNumber(payment.amount));
  const paymentType = getYooMoneyPaymentType(settings);

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Переход к оплате</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #090713;
        color: #fff8ef;
        font: 16px/1.5 system-ui, sans-serif;
      }
      .card {
        width: min(100% - 24px, 440px);
        padding: 28px;
        border: 1px solid rgba(170, 112, 255, 0.26);
        border-radius: 24px;
        background: linear-gradient(180deg, rgba(18, 14, 32, 0.98), rgba(10, 8, 18, 0.96));
        box-shadow: 0 30px 64px rgba(0, 0, 0, 0.34);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 28px;
        line-height: 1.05;
      }
      p {
        margin: 0 0 18px;
        color: rgba(235, 226, 248, 0.78);
      }
      button {
        width: 100%;
        min-height: 52px;
        border: 0;
        border-radius: 14px;
        background: linear-gradient(135deg, #ff7a1d, #ff8f26 52%, #ff6220);
        color: #fff8ef;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Переводим на оплату</h1>
      <p>Если страница провайдера не открылась автоматически, нажмите кнопку ниже.</p>
      <form id="checkout-form" method="POST" action="https://yoomoney.ru/quickpay/confirm">
        <input type="hidden" name="receiver" value="${escapeHtml(receiver)}" />
        <input type="hidden" name="quickpay-form" value="button" />
        <input type="hidden" name="paymentType" value="${escapeHtml(paymentType)}" />
        <input type="hidden" name="sum" value="${escapeHtml(amount)}" />
        <input type="hidden" name="label" value="${escapeHtml(paymentLabel)}" />
        <input type="hidden" name="targets" value="${escapeHtml(description)}" />
        <input type="hidden" name="successURL" value="${escapeHtml(successUrl)}" />
        <button type="submit">Открыть ЮMoney</button>
      </form>
    </main>
    <script>document.getElementById("checkout-form")?.submit();</script>
  </body>
</html>`;
}

export async function handlePlategaCallback(input: {
  amount: number;
  merchantIdHeader?: string | null;
  providerPaymentId: string;
  secretHeader?: string | null;
  status: string;
}) {
  const settings = await getSettingMap();
  const expectedMerchantId = ensureConfiguredSetting(
    settings,
    "platega_merchant_id",
    "Platega Merchant ID",
    "merchant-id-change-me"
  );
  const expectedSecret = ensureConfiguredSetting(
    settings,
    "platega_secret",
    "Platega Secret",
    "platega-secret-change-me"
  );

  if (input.merchantIdHeader !== expectedMerchantId || input.secretHeader !== expectedSecret) {
    throw new Error("Некорректная подпись callback Platega.");
  }

  const payment = await prisma.payment.findUnique({
    where: {
      providerPaymentId: input.providerPaymentId
    }
  });

  if (!payment) {
    throw new Error("Платеж Platega не найден.");
  }

  if (Math.abs(toNumber(payment.amount) - input.amount) > 0.01) {
    throw new Error("Сумма callback Platega не совпадает с суммой платежа.");
  }

  const normalizedStatus = input.status.trim().toUpperCase();
  if (normalizedStatus === "CONFIRMED") {
    return applyPaymentSuccess({
      paymentId: payment.id,
      providerPaymentId: input.providerPaymentId,
      providerStatus: normalizedStatus
    });
  }

  if (normalizedStatus === "CHARGEBACKED") {
    return applyPaymentFailure({
      paymentId: payment.id,
      providerPaymentId: input.providerPaymentId,
      providerStatus: normalizedStatus,
      status: "REFUNDED"
    });
  }

  if (normalizedStatus === "CANCELED") {
    return applyPaymentFailure({
      paymentId: payment.id,
      providerPaymentId: input.providerPaymentId,
      providerStatus: normalizedStatus,
      status: "CANCELED"
    });
  }

  return {
    paymentId: payment.id,
    status: payment.status
  };
}

export async function handleYooMoneyCallback(payload: Record<string, string>) {
  const settings = await getSettingMap();
  const secret = ensureConfiguredSetting(
    settings,
    "yoomoney_notification_secret",
    "ЮMoney секрет уведомлений",
    "yoomoney-secret-change-me"
  );
  const receivedSignature = payload.sign?.trim().toLowerCase();
  if (!receivedSignature) {
    throw new Error("В callback ЮMoney отсутствует подпись.");
  }

  const expectedSignature = buildYooMoneyNotificationSignature(payload, secret);
  if (!hasMatchingSignature(expectedSignature, receivedSignature)) {
    throw new Error("Некорректная подпись callback ЮMoney.");
  }

  const paymentId = extractPaymentIdFromLabel(payload.label);
  if (!paymentId) {
    throw new Error("В callback ЮMoney отсутствует корректная метка платежа.");
  }

  const payment = await prisma.payment.findUnique({
    where: {
      id: paymentId
    }
  });

  if (!payment) {
    throw new Error("Платеж ЮMoney не найден.");
  }

  const paidAmount = Number(payload.withdraw_amount ?? payload.amount ?? "0");
  if (!Number.isFinite(paidAmount) || Math.abs(toNumber(payment.amount) - paidAmount) > 0.01) {
    throw new Error("Сумма callback ЮMoney не совпадает с суммой платежа.");
  }

  if (payload.unaccepted?.trim().toLowerCase() === "true") {
    return {
      paymentId: payment.id,
      status: payment.status
    };
  }

  return applyPaymentSuccess({
    paymentId: payment.id,
    providerPaymentId: payload.operation_id ?? payment.providerPaymentId ?? null,
    providerStatus: payload.notification_type ?? "p2p-incoming"
  });
}

export async function handleYooKassaCallback(payload: Record<string, unknown>) {
  if (payload.type !== "notification") {
    throw new Error("Некорректный callback YooKassa.");
  }

  const event = typeof payload.event === "string" ? payload.event : "";
  const object = payload.object && typeof payload.object === "object" ? (payload.object as Record<string, unknown>) : null;
  const providerPaymentId = typeof object?.id === "string" ? object.id : null;

  if (!event || !providerPaymentId) {
    throw new Error("В callback YooKassa отсутствуют данные платежа.");
  }

  const settings = await getSettingMap();
  const providerPayment = await fetchYooKassaPayment({
    paymentId: providerPaymentId,
    settings
  });

  const localPaymentId =
    typeof providerPayment.metadata?.foxpoint_payment_id === "string" ? providerPayment.metadata.foxpoint_payment_id : null;

  if (!localPaymentId) {
    throw new Error("В callback YooKassa отсутствует идентификатор FoxPoint.");
  }

  const payment = await prisma.payment.findUnique({
    where: {
      id: localPaymentId
    }
  });

  if (!payment) {
    throw new Error("Платеж YooKassa не найден.");
  }

  if (payment.provider !== "yookassa") {
    throw new Error("Некорректный провайдер платежа YooKassa.");
  }

  if (payment.providerPaymentId && payment.providerPaymentId !== providerPayment.id) {
    throw new Error("Идентификатор платежа YooKassa не совпадает.");
  }

  const providerAmount = Number(providerPayment.amount?.value ?? "0");
  if (!Number.isFinite(providerAmount) || Math.abs(toNumber(payment.amount) - providerAmount) > 0.01) {
    throw new Error("Сумма callback YooKassa не совпадает с суммой платежа.");
  }

  const normalizedStatus = String(providerPayment.status ?? "").trim().toLowerCase();
  if (normalizedStatus === "succeeded") {
    return applyPaymentSuccess({
      paymentId: payment.id,
      providerPaymentId: providerPayment.id ?? payment.providerPaymentId ?? null,
      providerStatus: normalizedStatus
    });
  }

  if (normalizedStatus === "canceled") {
    return applyPaymentFailure({
      paymentId: payment.id,
      providerPaymentId: providerPayment.id ?? payment.providerPaymentId ?? null,
      providerStatus: normalizedStatus,
      status: "CANCELED"
    });
  }

  return {
    paymentId: payment.id,
    status: payment.status
  };
}

export async function buildAdminOverview(input: AdminDatabaseQuery = {}) {
  await ensureClientAndRouterCodes();
  const currentAdmin = await ensureAdminActorUser();
  const database = await buildAdminDatabase(input);
  const userRelationInclude = {
    identities: true,
    orders: {select:{status:true,receivedAt:true}},
    routers: {
      select: {
        id: true, trial: {select:{used:true}}
      }
    }
  } satisfies Prisma.UserInclude;
  const [settings, users, routers, subscriptions, orders, tickets, rewards, logs] = await Promise.all([
    getAdminSettings(),
    prisma.user.findMany({
      where: CLIENT_USER_WHERE,
      include: userRelationInclude,
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.router.findMany({
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            clientCode: true
            , city: true, archivedAt: true, isTest: true, status: true, phone: true, contactTelegram: true
          }
        },
        template: true, trial: true, subscriptions: { include: { lastPayment: true } }
      },
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.subscription.findMany({
      include: {
        router: {
          include: { owner: true, trial: true, template: true, payments: { where: { status: "PAID" }, orderBy: { paidAt: "desc" } } }
        }, lastPayment: true
      },
      orderBy: {
        endAt: "asc"
      }
    }),
    prisma.routerOrder.findMany({
      include: {
        user: {
          select: {
            name: true,
            id: true, clientCode: true, phone: true, contactTelegram: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
    }),
    prisma.supportTicket.findMany({
      select: {
        id: true,
        number: true,
        userId: true,
        routerId: true,
        category: true,
        description: true,
        guestContact: true,
        status: true,
        assigneeId: true,
        adminComment: true,
        adminCommentUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
        archivedAt: true,
        messages: {
          select: {
            id: true,
            authorRole: true,
            body: true,
            createdAt: true
          },
          orderBy: {
            createdAt: "asc"
          }
        },
        user: {
          select: {
            name: true,
            clientCode: true, phone: true, contactTelegram: true
          }
        },
        router: {
          select: {
            displayName: true,
            routerCode: true
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      },
    }),
    prisma.referralReward.findMany({
      include: { beneficiary: true, referred: true },
      orderBy: {
        createdAt: "desc"
      },
    }),
    prisma.adminAuditLog.findMany({
      include: { admin: { select: { name: true } } },
      orderBy: {
        createdAt: "desc"
      },
    })
  ]);

  const objectLinks = await adminAuditObjects(logs);
  const referrals=await prisma.referral.findMany({where:{referredUserId:{in:rewards.map(r=>r.referredUserId)}},include:{referrer:{select:{name:true,clientCode:true}}}});
  const referrerByReferred=new Map(referrals.map(r=>[r.referredUserId,r.referrer]));
  const registerMeta: Record<string, {total:number;page:number;pageSize:number}> = {};
  const paginate = <T extends Record<string,unknown>>(name:string, rows:T[], query:AdminDatabaseQuery, statusKey?:keyof AdminDatabaseQuery) => { const page=registerPage(rows,query,statusKey); registerMeta[name]={total:page.total,page:page.page,pageSize:page.pageSize}; return page.rows; };
  const recordInput: AdminDatabaseQuery = { pageSize:100 };

  return {
    ...database,
    dashboard: { ...database.dashboard,
      paidSubscriptions: subscriptions.filter(s=>!s.router.archivedAt && !s.router.owner.archivedAt && !s.router.owner.isTest && s.router.status==="ACTIVE" && s.router.owner.status==="ACTIVE" && s.status==="ACTIVE" && !s.pendingActivation && s.endAt && s.endAt>new Date() && s.lastPayment?.status==="PAID" && Number(s.lastPayment.amount)>0).length,
      expiringSubscriptions: subscriptions.filter(s=>!s.router.archivedAt && !s.router.owner.archivedAt && s.status==="ACTIVE" && !s.pendingActivation && s.endAt && s.endAt>new Date() && getDaysRemaining(s.endAt)!<=5).length,
      newTickets: tickets.filter(t=>t.status==="OPEN" && !t.archivedAt).length
    },
    reconciliation: await importReconciliation(),
    stats: {
      users: await prisma.user.count({ where: CLIENT_USER_WHERE }),
      routers: await prisma.router.count(),
      activeSubscriptions: await prisma.subscription.count({
        where: {
          status: "ACTIVE", pendingActivation: false, endAt: { gt: new Date() }, router: { owner: { is: CLIENT_USER_WHERE } }
        }
      }),
      openTickets: await prisma.supportTicket.count({
        where: {
          status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] }, archivedAt: null
        }
      })
    },
    settings,
    users: users.map(user=>({...mapAdminUserRecord(user),archivedAt:user.archivedAt?.toISOString()??null,
      trialReceivedOrders:user.orders.filter(o=>o.status==="RECEIVED"&&o.receivedAt).length,trialUsed:user.routers.filter(r=>r.trial?.used).length})),
    routers: paginate("routers", routers.map((router) => ({
      id: router.id,
      routerCode: router.routerCode,
      clientCode: router.owner.clientCode,
      serviceTariff: router.serviceTariff,
      displayName: router.displayName,
      model: router.model,
      serialNumber: router.serialNumber,
      configurationType: router.configurationType,
      status: router.status,
      ownerId: router.owner.id,
      archivedAt: router.archivedAt?.toISOString() ?? null,
      ownerName: router.owner.name ?? router.owner.id,
      savedTemplate: router.template ? describeBundle(router.template) : "Не выбран",
      planPrice: toNumber(router.template?.priceOverride ?? router.template?.currentPrice),
      planPeriodDays: router.template?.periodDays ?? 30,
      planAccessEnabled: router.template?.accessEnabled ?? false,
      planSupportType: router.template?.supportType ?? "NONE",
      adminNote: router.adminNote,
      monitorHost: router.monitorHost, monitorPort: router.monitorPort,
      services: router.subscriptions.filter(s=>s.status!=="CANCELLED").map(s=>({id:s.id,accessEnabled:s.accessEnabled,supportType:s.supportType,endAt:s.endAt?.toISOString()??null,startAt:s.startAt?.toISOString()??null,pendingActivation:s.pendingActivation,pendingDays:s.pendingDays})),
      plan: router.serviceTariff ?? (router.template?.accessEnabled ? router.template.supportType !== "NONE" ? "Полный" : "Сервер" : router.template?.supportType !== "NONE" ? "Техничка" : "Самостоятельно"),
      city: router.owner.city, name: router.owner.name,
      endAt: router.subscriptions.map(s=>s.endAt?.toISOString()).filter(Boolean).sort()[0] ?? null,
      daysRemaining: Math.min(...router.subscriptions.map(s=>getDaysRemaining(s.endAt)??999)),
      pendingActivation: router.subscriptions.some(s=>s.pendingActivation),
      paidActive: !router.archivedAt && !router.owner.archivedAt && !router.owner.isTest && router.owner.status === "ACTIVE" && router.status === "ACTIVE" && router.subscriptions.some(s=>s.status === "ACTIVE" && !s.pendingActivation && s.endAt && s.endAt > new Date() && s.lastPayment?.status === "PAID" && Number(s.lastPayment.amount)>0),
      searchText: [router.id,router.routerCode,...router.codeAliases,router.displayName,router.owner.id,router.owner.name,router.owner.clientCode,router.owner.phone,router.owner.contactTelegram].join(" "),
      createdAt: router.createdAt.toISOString()
    })), input.tab === "routers" ? input : recordInput),
    subscriptions: paginate("subscriptions", subscriptions.map((subscription) => ({
      id: subscription.id,
      routerId: subscription.routerId,
      routerName: subscription.router.displayName,
      routerCode: subscription.router.routerCode,
      clientCode: subscription.router.owner.clientCode, userId: subscription.router.ownerUserId, customerName: subscription.router.owner.name,
      plan: subscription.router.serviceTariff ?? describeBundle(subscription), city: subscription.router.owner.city,
      archivedAt: subscription.router.archivedAt?.toISOString() ?? subscription.router.owner.archivedAt?.toISOString() ?? null,
      isTrial: Number(subscription.priceSnapshot)===0 && !!subscription.router.trial?.endAt && subscription.router.trial.endAt > new Date(),
      paidActive: !subscription.router.archivedAt && !subscription.router.owner.archivedAt && !subscription.router.owner.isTest && subscription.router.status === "ACTIVE" && subscription.router.owner.status === "ACTIVE" && subscription.status === "ACTIVE" && !subscription.pendingActivation && !!subscription.endAt && subscription.endAt > new Date() && subscription.lastPayment?.status === "PAID" && Number(subscription.lastPayment.amount)>0,
      searchText: [subscription.id,subscription.routerId,subscription.router.routerCode,subscription.router.displayName,subscription.router.owner.clientCode,subscription.router.owner.name,subscription.router.owner.phone,subscription.router.owner.contactTelegram].join(" "),
      createdAt: subscription.startAt?.toISOString() ?? subscription.router.createdAt.toISOString(),
      bundleLabel: subscription.router.serviceTariff ?? describeBundle(subscription),
      daysRemaining: getDaysRemaining(subscription.endAt),
      payments: subscription.router.payments.map((payment) => ({
        id: payment.id, amountLabel: formatMoney(toNumber(payment.amount)), daysAdded: payment.daysAdded,
        paidAt: payment.paidAt?.toISOString() ?? null, provider: payment.provider
      })),
      status: getEffectiveSubscriptionStatus(subscription) ?? subscription.status,
      startAt: subscription.startAt?.toISOString() ?? null,
      endAt: subscription.endAt?.toISOString() ?? null,
      price: toNumber(subscription.priceSnapshot),
      priceLabel: formatMoney(toNumber(subscription.priceSnapshot)),
      accessEnabled: subscription.accessEnabled,
      supportType: subscription.supportType,
      pendingActivation: subscription.pendingActivation
      ,pendingDays: subscription.pendingDays, periodDays: subscription.router.template?.periodDays ?? 30,
      nextPrice: toNumber(subscription.router.template?.priceOverride ?? subscription.router.template?.currentPrice ?? subscription.priceSnapshot),
    })), input.tab === "subscriptions" ? input : recordInput),
    orders: paginate("orders", orders.map((order) => ({
      clientCode: order.user.clientCode,
      searchText: [order.id,order.user.name,order.user.clientCode,order.user.phone,order.user.contactTelegram,order.trackingNumber].join(" "),
      id: order.id,
      userId: order.userId,
      customerName: order.user.name ?? order.user.id,
      status: order.status,
      totalPrice: toNumber(order.totalPrice),
      totalPriceLabel: formatMoney(toNumber(order.totalPrice)),
      trackingNumber: order.trackingNumber,
      createdAt: order.createdAt.toISOString(),
      receivedAt: order.receivedAt?.toISOString() ?? null
    })), {...input,plan:"",city:"",expiry:""},"orderStatus"),
    tickets: paginate("tickets", tickets.map((ticket) => ({
      id: ticket.id,
      number: ticket.number,
      userId: ticket.userId,
      routerId: ticket.routerId,
      customerName: ticket.user.name ?? "Клиент",
      clientCode: ticket.user.clientCode,
      routerCode: ticket.router?.routerCode ?? null,
      guestContact: ticket.guestContact,
      contact: ticket.guestContact ?? ticket.user.phone ?? ticket.user.contactTelegram,
      routerName: ticket.router?.displayName ?? "Без роутера",
      category: ticket.category,
      description: ticket.description,
      status: ticket.status,
      assigneeId: ticket.assigneeId,
      adminComment: ticket.adminComment,
      adminCommentUpdatedAt: ticket.adminCommentUpdatedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      archivedAt: ticket.archivedAt?.toISOString() ?? null,
      messages: mapSupportTicketMessages({
        adminComment: ticket.adminComment,
        adminCommentUpdatedAt: ticket.adminCommentUpdatedAt ?? null,
        createdAt: ticket.createdAt,
        description: ticket.description,
        id: ticket.id,
        messages: ticket.messages
      })
    })), {...input,plan:"",city:"",expiry:""},"ticketStatus"),
    rewardTotals: {pending:rewards.filter(r=>r.status==="PENDING").reduce((sum,r)=>sum+toNumber(r.amount),0),available:rewards.filter(r=>r.status==="AVAILABLE").reduce((sum,r)=>sum+toNumber(r.amount),0),canceled:rewards.filter(r=>r.status==="CANCELED").reduce((sum,r)=>sum+toNumber(r.amount),0)},
    rewards: paginate("rewards", rewards.map((reward) => ({
      id: reward.id,
      amount: toNumber(reward.amount),
      amountLabel: formatMoney(toNumber(reward.amount)),
      status: reward.status,
      sourceType: reward.sourceType,
      beneficiaryName: reward.beneficiary.name, beneficiaryCode: reward.beneficiary.clientCode, referredName: reward.referred.name, referredCode: reward.referred.clientCode,
      referrerName:referrerByReferred.get(reward.referredUserId)?.name??null,referrerCode:referrerByReferred.get(reward.referredUserId)?.clientCode??null,
      sourceId: reward.sourceId, paymentId: reward.paymentId, availableAt: reward.availableAt?.toISOString() ?? null,
      createdAt: reward.createdAt.toISOString()
    })), {...input,plan:"",city:"",expiry:""},"rewardStatus"),
    logs: paginate("logs", logs.map((log,index) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId, admin: log.admin.name ?? log.adminId, beforeData: safeAudit(log.beforeData), afterData: safeAudit(log.afterData),
      href: objectLinks[index].href, objectLabel: objectLinks[index].label,
      createdAt: log.createdAt.toISOString()
    })), {...input,plan:"",city:"",expiry:""}),
    registerMeta,
    administrators: await prisma.user.findMany({ where: { identities: { some: { provider: "EMAIL", email: { startsWith: "admin+", endsWith: "@foxpoint.local" } } } }, select: { id:true,name:true } }),
    currentAdmin: currentAdmin.id
    , integrations: [
      {id:"platega",label:"Platega",keys:["platega_api_base_url","platega_merchant_id","platega_secret"]},
      {id:"yoomoney",label:"ЮMoney",keys:["yoomoney_receiver","yoomoney_payment_type","yoomoney_notification_secret"]},
      {id:"yookassa",label:"ЮKassa",keys:["yookassa_shop_id","yookassa_secret_key"]}
    ].map(p=>({id:p.id,label:p.label,enabled:settings.find(s=>s.key===`${p.id}_enabled`)?.value==="true",ready:p.keys.every(k=>!!settings.find(s=>s.key===k)?.value?.trim())}))
  };
}

export async function updateAdminTicket(input: {
  archived?: boolean;
  adminComment?: string | null;
  assigneeId?: string | null;
  status: TicketStatus;
  ticketId: string;
}) {
  if (input.assigneeId) {
    const administrator = await prisma.user.findFirst({ where: { id: input.assigneeId, identities: { some: { provider: "EMAIL", email: { startsWith: "admin+", endsWith: "@foxpoint.local" } } } } });
    if (!administrator) throw new Error("Выберите существующего администратора.");
  }
  const ticket = await prisma.supportTicket.findUnique({
    where: {
      id: input.ticketId
    },
    include: {
      messages: {
        select: {
          authorRole: true
        }
      }
    }
  });

  if (!ticket) {
    throw new Error("Обращение не найдено.");
  }

  const shouldAddOperatorWaitMessage =
    ticket.status !== "IN_PROGRESS" &&
    input.status === "IN_PROGRESS" &&
    !ticket.messages.some((message) => message.authorRole === "ADMIN");

  const updated = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${input.ticketId} FOR UPDATE`;
    const previous = await tx.supportTicket.findUniqueOrThrow({ where: { id: input.ticketId } });
    const changed = await tx.supportTicket.update({ where: { id: input.ticketId }, data: { status: input.status, assigneeId: input.assigneeId?.trim() || null,
      archivedAt: input.archived === undefined ? previous.archivedAt : input.archived ? previous.archivedAt ?? new Date() : null } });
    if (previous.status !== input.status) {
      const statuses: Record<string, string> = { OPEN: "Открыто", IN_PROGRESS: "В работе", WAITING_CLIENT: "Ожидаем ваш ответ", RESOLVED: "Решено", CLOSED: "Закрыто" };
      await createClientNotification(tx, { userId: ticket.userId, type: "SUPPORT_STATUS", relatedType: "SupportTicket", relatedId: ticket.id,
        title: `Статус обращения · #${ticket.number}`, detail: statuses[input.status] ?? input.status, href: `/cabinet/support?ticket=${ticket.id}#ticket-${ticket.id}` });
    }
    return changed;
  });

  if (shouldAddOperatorWaitMessage) {
    await appendSupportTicketMessage({
      authorRole: "ADMIN",
      body: "Ожидайте оператора.",
      ticketId: input.ticketId
    });
  }

  if (input.adminComment?.trim()) {
    await appendSupportTicketMessage({
      authorRole: "ADMIN",
      body: input.adminComment,
      ticketId: input.ticketId
    });
  }

  await recordAdminAction({
    action: "ticket_updated",
    entityType: "SupportTicket",
    entityId: updated.id,
    beforeData: {
      status: ticket.status,
      assigneeId: ticket.assigneeId,
      archivedAt: ticket.archivedAt?.toISOString() ?? null,
      adminComment: ticket.adminComment
    },
    afterData: {
      status: updated.status,
      assigneeId: updated.assigneeId,
      archivedAt: updated.archivedAt?.toISOString() ?? null,
      adminComment: input.adminComment?.trim() || ticket.adminComment
    }
  });

  return {
    ticketId: updated.id
  };
}

export async function deleteAdminTicket(input: { ticketId: string }) {
  const ticket = await prisma.supportTicket.findUnique({
    where: {
      id: input.ticketId
    }
  });

  if (!ticket) {
    throw new Error("Обращение не найдено.");
  }

  await prisma.supportTicket.update({
    where: {
      id: input.ticketId
    }, data: { archivedAt: new Date() }
  });

  await recordAdminAction({
    action: "ticket_archived",
    entityType: "SupportTicket",
    entityId: ticket.id,
    beforeData: {
      userId: ticket.userId,
      routerId: ticket.routerId,
      category: ticket.category,
      status: ticket.status,
      assigneeId: ticket.assigneeId,
      adminComment: ticket.adminComment
    }
  });

  return {
    ticketId: ticket.id
  };
}

export async function updateAdminOrder(input: {
  orderId: string;
  status: OrderStatus;
  trackingNumber?: string | null;
}) {
  const order = await prisma.routerOrder.findUnique({
    where: {
      id: input.orderId
    }
  });

  if (!order) {
    throw new Error("Заказ не найден.");
  }

  const nextTrackingNumber = input.trackingNumber?.trim() || null;
  const shouldMarkReceived = input.status === "RECEIVED";
  const updated = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "RouterOrder" WHERE "id" = ${input.orderId} FOR UPDATE`;
    const previous = await tx.routerOrder.findUniqueOrThrow({ where: { id: input.orderId } });
    const changed = await tx.routerOrder.update({ where: { id: input.orderId }, data: { status: input.status, trackingNumber: nextTrackingNumber, receivedAt: shouldMarkReceived ? previous.receivedAt ?? new Date() : previous.receivedAt } });
    if (previous.status !== input.status || previous.trackingNumber !== nextTrackingNumber) {
      const statuses: Record<string, string> = { CREATED: "Создан", WAITING_PAYMENT: "Ожидает оплаты", PAID: "Оплачен", CONFIGURING: "Настраивается", READY_TO_SHIP: "Готов к отправке", REFUND: "Возврат", SHIPPED: "Отправлен", RECEIVED: "Получен", CANCELED: "Отменён" };
      await createClientNotification(tx, { userId: order.userId, type: "ORDER_UPDATED", relatedType: "RouterOrder", relatedId: order.id,
        title: "Заказ роутера обновлён", detail: `${statuses[input.status] ?? input.status}${nextTrackingNumber ? ` · трек-номер ${nextTrackingNumber}` : ""}`, href: "/cabinet/routers" });
    }
    return changed;
  });

  await recordAdminAction({
    action: "order_updated",
    entityType: "RouterOrder",
    entityId: updated.id,
    beforeData: {
      status: order.status,
      trackingNumber: order.trackingNumber,
      receivedAt: order.receivedAt?.toISOString() ?? null
    },
    afterData: {
      status: updated.status,
      trackingNumber: updated.trackingNumber,
      receivedAt: updated.receivedAt?.toISOString() ?? null
    }
  });

  return {
    orderId: updated.id
  };
}

export async function deleteAdminOrder(input: { orderId: string }) {
  const order = await prisma.routerOrder.findUnique({
    where: {
      id: input.orderId
    }
  });

  if (!order) {
    throw new Error("Заказ не найден.");
  }

  await prisma.routerOrder.delete({
    where: {
      id: input.orderId
    }
  });

  await recordAdminAction({
    action: "order_deleted",
    entityType: "RouterOrder",
    entityId: order.id,
    beforeData: {
      status: order.status,
      trackingNumber: order.trackingNumber,
      receivedAt: order.receivedAt?.toISOString() ?? null,
      totalPrice: toNumber(order.totalPrice),
      userId: order.userId
    }
  });

  return {
    orderId: order.id
  };
}

export async function deleteAdminRouter(input: { routerId: string }) {
  const router = await prisma.router.findUnique({
    where: {
      id: input.routerId
    }
  });

  if (!router) {
    throw new Error("Роутер не найден.");
  }

  await prisma.router.update({
    where: {
      id: input.routerId
    }, data: { archivedAt: new Date() }
  });

  await recordAdminAction({
    action: "router_archived",
    entityType: "Router",
    entityId: router.id,
    beforeData: {
      adminNote: router.adminNote,
      configurationType: router.configurationType,
      displayName: router.displayName,
      ownerUserId: router.ownerUserId,
      model: router.model,
      serialNumber: router.serialNumber,
      status: router.status
    }, afterData: { archivedAt: new Date().toISOString(), reason: "Архивирование роутера администратором" }
  });

  return {
    routerId: router.id
  };
}

export async function updateAdminRouter(input: {
  adminNote?: string | null; configurationType: ConfigurationType; displayName: string; ownerUserId: string;
  model?: string | null; routerId: string; serialNumber?: string | null; status: RouterStatus;
  serviceTariff?: string; planPrice?: number; planPeriodDays?: number; planAccessEnabled?: boolean; planSupportType?: SupportType;
  archived?: boolean;
  reason?: string;
  monitorHost?: string; monitorPort?: number;
}) {
  if (input.serviceTariff === "Индивидуальный" && (!input.planPrice || !input.planPeriodDays || (!input.planAccessEnabled && (!input.planSupportType || input.planSupportType === "NONE")))) throw new Error("Для индивидуального плана задайте состав, цену и срок.");
  const actor = await ensureAdminActorUser();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Router" WHERE "id" = ${input.routerId} FOR UPDATE`;
    if(input.serialNumber?.trim()) {
      const serial=input.serialNumber.trim();await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`serial:${serial.toLowerCase()}`},0))`;
      if(await tx.router.findFirst({where:{id:{not:input.routerId},serialNumber:{equals:serial,mode:"insensitive"}}}))throw new Error("Серийный номер уже указан у другого роутера.");
    }
    const router = await tx.router.findUniqueOrThrow({ where: { id: input.routerId }, include: { template: true } });
    await tx.user.findUniqueOrThrow({ where: { id: input.ownerUserId } });
    const updated = await tx.router.update({ where: { id: input.routerId }, data: {
      ownerUserId: input.ownerUserId, displayName: input.displayName.trim(), model: input.model?.trim() || null,
      serialNumber: input.serialNumber?.trim() || null, configurationType: input.configurationType, status: input.status,
      adminNote: input.adminNote?.trim() || null, serviceTariff: input.serviceTariff ?? router.serviceTariff,
      monitorHost: input.monitorHost === undefined ? router.monitorHost : input.monitorHost.trim() || null,
      monitorPort: input.monitorPort === undefined ? router.monitorPort : input.monitorPort || null,
      archivedAt: input.archived === undefined ? router.archivedAt : input.archived ? router.archivedAt ?? new Date() : null
    } });
    if (input.serviceTariff) {
      const accessEnabled = input.serviceTariff === "Индивидуальный" ? !!input.planAccessEnabled : ["Сервер", "Полный"].includes(input.serviceTariff);
      const supportType: SupportType = input.serviceTariff === "Индивидуальный" ? input.planSupportType ?? "NONE" : ["Техничка", "Полный"].includes(input.serviceTariff) ? "BASIC" : "NONE";
      const price = input.serviceTariff === "Самостоятельно" ? 0 : input.planPrice ?? (input.serviceTariff === "Полный" ? 2000 : 1000);
      if (input.serviceTariff !== "Самостоятельно" && price <= 0) throw new Error("Для платного плана задайте положительную цену.");
      const data = { accessEnabled, supportType, periodDays: input.serviceTariff === "Индивидуальный" ? input.planPeriodDays! : 30, currentPrice: price, priceOverride: price };
      await tx.subscriptionTemplate.upsert({ where: { routerId: router.id }, create: { routerId: router.id, ...data }, update: data });
      if (input.serviceTariff === "Самостоятельно") await tx.subscription.updateMany({ where: { routerId: router.id }, data: { status: "CANCELLED", pendingActivation: false, pendingDays: 0 } });
    }
    const after = await tx.router.findUniqueOrThrow({ where: { id: router.id }, include: { template: true } });
    await tx.adminAuditLog.create({ data: { adminId: actor.id, entityType: "Router", entityId: router.id, action: "router_updated",
      beforeData: JSON.parse(JSON.stringify(router)), afterData: JSON.parse(JSON.stringify({ ...after, reason: input.reason?.trim() || "Изменение роутера через админку" })) } });
    return { routerId: updated.id };
  });
}

export async function updateAdminSubscription(input: {
  endAt?: string | null; pendingActivation: boolean; startAt?: string | null; status: SubscriptionStatus; subscriptionId: string;
  reason?: string;
}) {
  const initial = await prisma.subscription.findUniqueOrThrow({ where: { id: input.subscriptionId } });
  const actor = await ensureAdminActorUser();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Router" WHERE "id" = ${initial.routerId} FOR UPDATE`;
    const subscription = await tx.subscription.findUniqueOrThrow({ where: { id: input.subscriptionId } });
    const router = await tx.router.findUniqueOrThrow({ where: { id: subscription.routerId } });
    if (router.serviceTariff === "Самостоятельно" && input.status !== "CANCELLED") throw new Error("Самостоятельное обслуживание не имеет подписки.");
    const parseMoscow = (value: string | null | undefined) => value?.trim() ? new Date(/[Zz]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}+03:00`) : null;
    let startAt = parseMoscow(input.startAt), endAt = parseMoscow(input.endAt);
    // A status-only save must retain seconds/milliseconds hidden by datetime-local.
    if (startAt && subscription.startAt && Math.floor(startAt.getTime() / 60000) === Math.floor(subscription.startAt.getTime() / 60000)) startAt = subscription.startAt;
    if (endAt && subscription.endAt && Math.floor(endAt.getTime() / 60000) === Math.floor(subscription.endAt.getTime() / 60000)) endAt = subscription.endAt;
    const activating = subscription.pendingActivation && !input.pendingActivation && input.status === "ACTIVE";
    if (activating) {
      if (!subscription.pendingDays) throw new Error("Нет сохранённых дней активации. Сначала сверить исходную оплату.");
      startAt = new Date(); endAt = extendSubscriptionEnd(null, subscription.pendingDays, startAt);
    }
    if ([startAt, endAt].some(date => date && Number.isNaN(date.getTime()))) throw new Error("Некорректная дата.");
    if (startAt && endAt && endAt <= startAt) throw new Error("Окончание должно быть позже начала.");
    if (input.pendingActivation) {
      if (!subscription.pendingDays && subscription.endAt) throw new Error("Нельзя скрыть действующий срок. Сначала сверить дни ожидания активации.");
      startAt = null; endAt = null;
    }
    const updated = await tx.subscription.update({ where: { id: subscription.id }, data: {
      status: input.pendingActivation ? "PENDING_ACTIVATION" : input.status, startAt, endAt, pendingActivation: input.pendingActivation,
      pendingDays: activating ? 0 : subscription.pendingDays
    } });
    if (activating && Number(subscription.priceSnapshot) === 0) await tx.trial.updateMany({ where: { routerId: router.id, used: true }, data: { startAt, endAt } });
    await tx.adminAuditLog.create({ data: { adminId: actor.id, entityType: "Subscription", entityId: updated.id, action: "subscription_updated",
      beforeData: JSON.parse(JSON.stringify(subscription)), afterData: JSON.parse(JSON.stringify({ ...updated, reason: input.reason?.trim() || (activating ? "Подтверждение технической активации" : "Изменение подписки через админку") })) } });
    return { subscriptionId: updated.id };
  });
}

export async function updateAdminReward(input: {
  rewardId: string;
  status: RewardStatus;
}) {
  const reward = await prisma.referralReward.findUnique({
    where: {
      id: input.rewardId
    }
  });

  if (!reward) {
    throw new Error("Начисление не найдено.");
  }

  const updated = await prisma.referralReward.update({
    where: {
      id: input.rewardId
    },
    data: {
      status: input.status,
      availableAt: input.status === "AVAILABLE" ? reward.availableAt ?? new Date() : reward.availableAt
    }
  });

  await recordAdminAction({
    action: "reward_updated",
    entityType: "ReferralReward",
    entityId: updated.id,
    beforeData: {
      status: reward.status,
      availableAt: reward.availableAt?.toISOString() ?? null
    },
    afterData: {
      status: updated.status,
      availableAt: updated.availableAt?.toISOString() ?? null
    }
  });

  return {
    rewardId: updated.id
  };
}

export async function updateAdminUser(input: {
  email?: string | null;
  name?: string | null;
  publicName?: string | null;
  reason?: string;
  phone?: string | null;
  city?: string | null;
  status: UserStatus;
  archived?: boolean;
  isTest?: boolean;
  telegramUsername?: string | null;
  userId: string;
}) {
  const user = await prisma.user.findUnique({
    where: {
      id: input.userId
    },
    include: {
      identities: true
    }
  });

  if (!user) {
    throw new Error("Клиент не найден.");
  }

  const existingEmail = getPrimaryEmail(user.identities);
  const existingTelegramIdentity = user.identities.find((identity) => identity.provider === "TELEGRAM") ?? null;
  const existingTelegramUsername = existingTelegramIdentity?.email?.replace(/^@+/, "") ?? null;
  const nextName = input.name?.trim() || null;
  const nextEmail = input.email?.trim() ? input.email.trim().toLowerCase() : null;
  const nextTelegramUsername = input.telegramUsername?.trim()
    ? input.telegramUsername.trim().replace(/^@+/, "")
    : null;

  if (nextEmail) {
    const conflictingIdentity = await prisma.authIdentity.findFirst({
      where: {
        provider: "EMAIL",
        email: nextEmail,
        NOT: {
          userId: input.userId
        }
      }
    });

    if (conflictingIdentity) {
      throw new Error("Этот email уже используется в другом аккаунте.");
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const emailIdentity = user.identities.find((identity) => identity.provider === "EMAIL") ?? null;
    let resolvedEmail = existingEmail;
    let resolvedTelegramUsername = existingTelegramUsername;

    if (nextEmail) {
      if (emailIdentity) {
        const identity = await tx.authIdentity.update({
          where: {
            id: emailIdentity.id
          },
          data: {
            providerUserId: nextEmail,
            email: nextEmail,
            verifiedAt: emailIdentity.verifiedAt ?? new Date()
          }
        });
        resolvedEmail = identity.email;
      } else {
        const identity = await tx.authIdentity.create({
          data: {
            userId: input.userId,
            provider: "EMAIL",
            providerUserId: nextEmail,
            email: nextEmail,
            verifiedAt: new Date()
          }
        });
        resolvedEmail = identity.email;
      }
    }

    if (existingTelegramIdentity) {
      const identity = await tx.authIdentity.update({
        where: {
          id: existingTelegramIdentity.id
        },
        data: {
          email: nextTelegramUsername
        }
      });
      resolvedTelegramUsername = identity.email?.replace(/^@+/, "") ?? null;
    }

    const updatedUser = await tx.user.update({
      where: {
        id: input.userId
      },
      data: {
        name: nextName,
        publicName: input.publicName === undefined ? user.publicName : input.publicName?.trim() || null,
        phone: input.phone?.trim() || null,
        city: input.city?.trim() || null,
        contactTelegram: existingTelegramIdentity ? user.contactTelegram : nextTelegramUsername,
        status: input.status,
        archivedAt: input.archived === undefined ? user.archivedAt : input.archived ? user.archivedAt ?? new Date() : null,
        isTest: input.isTest ?? user.isTest
      }
    });

    return {
      email: resolvedEmail,
      telegramUsername: resolvedTelegramUsername,
      user: updatedUser
    };
  });

  await recordAdminAction({
    action: "user_updated",
    entityType: "User",
    entityId: updated.user.id,
    beforeData: {
      name: user.name,
      publicName: user.publicName,
      phone: user.phone, city: user.city, contactTelegram: user.contactTelegram,
      email: existingEmail,
      telegramUsername: existingTelegramUsername,
      status: user.status
      ,archivedAt: user.archivedAt?.toISOString() ?? null, isTest: user.isTest
    },
    afterData: {
      name: updated.user.name,
      publicName: updated.user.publicName,
      phone: updated.user.phone, city: updated.user.city, contactTelegram: updated.user.contactTelegram,
      reason: input.reason?.trim() || "Изменение клиента через админку",
      email: updated.email,
      telegramUsername: updated.telegramUsername,
      status: updated.user.status
      ,archivedAt: updated.user.archivedAt?.toISOString() ?? null, isTest: updated.user.isTest
    }
  });

  return {
    userId: updated.user.id
  };
}

export async function createAdminRouterAssignment(input: {
  accessEnabled: boolean;
  adminNote?: string;
  configurationType: "BASIC" | "EXTENDED";
  displayName: string;
  model?: string;
  serialNumber?: string;
  startTrial: boolean;
  supportType: SupportType;
  userId: string;
  serviceTariff?: BusinessPlan; planPrice?: number; planPeriodDays?: number; monitorHost?: string; monitorPort?: number;
}) {
  const settings = await getSettingMap();
  const owner = await prisma.user.findUnique({
    where: {
      id: input.userId
    }
  });

  if (!owner) {
    throw new Error("Клиент не найден.");
  }

  const now = new Date();
  const periodDays = SUBSCRIPTION_MONTH_DAYS;
  const trialDays = 14;
  const chosen = input.serviceTariff ? businessPlan({ plan: input.serviceTariff, price: input.planPrice ?? 0, periodDays: input.planPeriodDays, accessEnabled: input.accessEnabled, supportType: input.supportType }) : null;
  if (chosen) { input = { ...input, accessEnabled: chosen.accessEnabled, supportType: chosen.supportType }; }
  if (input.startTrial && input.serviceTariff === "Самостоятельно") throw new Error("Самостоятельный план не имеет пробной подписки.");
  const templatePrice = chosen?.currentPrice ?? calculateBundlePrice(settings, input);
  const price = input.startTrial ? 0 : templatePrice;

  const router = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
    if(owner.archivedAt)throw new Error("Сначала восстановите клиента из архива.");
    if(input.serialNumber?.trim()) {const serial=input.serialNumber.trim();await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`serial:${serial.toLowerCase()}`},0))`;if(await tx.router.findFirst({where:{serialNumber:{equals:serial,mode:"insensitive"}}}))throw new Error("Серийный номер уже указан у другого роутера.");}
    if (input.startTrial) {
      const received = await tx.routerOrder.count({ where: { userId: input.userId, status: "RECEIVED", receivedAt: { not: null } } });
      const used = await tx.trial.count({ where: { used: true, router: { ownerUserId: input.userId } } });
      if (received <= used) throw new Error("14-дневный тест доступен для полученного устройства проекта. Подтвердите получение заказа.");
      if (!input.accessEnabled && input.supportType === "NONE") throw new Error("Выберите услуги теста.");
    }
    const needsActivation = input.accessEnabled || input.supportType !== "NONE";
    const createdRouter = await tx.router.create({
      data: {
        ownerUserId: input.userId,
        displayName: input.displayName.trim(),
        model: input.model?.trim() || null,
        serialNumber: input.serialNumber?.trim() || null,
        configurationType: input.configurationType,
        status: "ACTIVE",
        serviceTariff: input.serviceTariff ?? null, monitorHost: input.monitorHost?.trim() || null, monitorPort: input.monitorPort || null,
        adminNote: input.adminNote?.trim() || null
      }
    });

    await assignMissingCodes(tx);

    await tx.subscriptionTemplate.create({
      data: {
        routerId: createdRouter.id,
        accessEnabled: input.accessEnabled,
        supportType: input.supportType,
        periodDays: chosen?.periodDays ?? periodDays,
        currentPrice: templatePrice
      }
    });

    if (input.accessEnabled || input.supportType !== "NONE") {
      await tx.subscription.create({
        data: {
          routerId: createdRouter.id,
          accessEnabled: input.accessEnabled,
          supportType: input.supportType,
          status: input.startTrial ? needsActivation ? "PENDING_ACTIVATION" : "ACTIVE" : "DRAFT",
          startAt: input.startTrial && !needsActivation ? now : null,
          endAt: input.startTrial && !needsActivation ? new Date(now.getTime() + trialDays * DAY_MS) : null,
          priceSnapshot: price, pendingActivation: needsActivation, pendingDays: input.startTrial && needsActivation ? trialDays : 0
        }
      });
    }

    if (input.startTrial) {
      await tx.trial.create({
        data: {
          routerId: createdRouter.id,
          used: true,
          startAt: needsActivation ? null : now,
          endAt: needsActivation ? null : new Date(now.getTime() + trialDays * DAY_MS),
          packageSnapshot: {
            accessEnabled: input.accessEnabled,
            supportType: input.supportType,
            packageName: settings.get("trial_package_name") ?? "Интернет, как раньше+"
          }
        }
      });
    }

    return createdRouter;
  });

  await recordAdminAction({
    action: "router_assigned",
    entityType: "Router",
    entityId: router.id,
    afterData: {
      userId: input.userId,
      displayName: input.displayName,
      accessEnabled: input.accessEnabled,
      supportType: input.supportType,
      startTrial: input.startTrial
    }
  });

  return {
    routerId: router.id
  };
}
