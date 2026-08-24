import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ConfigurationType,
  OrderStatus,
  PaymentStatus,
  RewardStatus,
  RouterStatus,
  SubscriptionStatus,
  SupportType,
  TicketStatus,
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

type SettingMap = Map<string, string>;
type PublicLinks = Awaited<ReturnType<typeof getPublicSettingLinks>>;
type PaymentProviderId = "manual_mvp" | "platega" | "yoomoney";
type ClientPaymentMethodId = Exclude<PaymentProviderId, "manual_mvp">;
type RouterTemplateLike = {
  accessEnabled: boolean;
  supportType: SupportType;
};

function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) {
    return 0;
  }

  return Number(value);
}

function formatMoney(amount: number): string {
  return `${amount.toLocaleString("ru-RU")} ₽`;
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
      enabled: getBooleanSetting(settings, "platega_enabled", true)
    },
    {
      id: "yoomoney" as const,
      label: "ЮMoney",
      description: "Оплата через кошелек ЮMoney или банковскую карту.",
      enabled: getBooleanSetting(settings, "yoomoney_enabled", true)
    }
  ];
}

function isPlategaConfigured(settings: SettingMap): boolean {
  return Boolean(
    getSettingValue(settings, "platega_api_base_url") &&
      getSettingValue(settings, "platega_merchant_id") &&
      getSettingValue(settings, "platega_secret") &&
      getSettingValue(settings, "platega_api_base_url") !== "https://app.platega.io" &&
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

function getPaymentProviderLabel(provider: string): string {
  if (provider === "platega") {
    return "Platega";
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
  if (normalized === "platega" && getBooleanSetting(settings, "platega_enabled", true) && isPlategaConfigured(settings)) {
    return "platega";
  }

  if (
    normalized === "yoomoney" &&
    getBooleanSetting(settings, "yoomoney_enabled", true) &&
    isYooMoneyConfigured(settings)
  ) {
    return "yoomoney";
  }

  if (getBooleanSetting(settings, "platega_enabled", true) && isPlategaConfigured(settings)) {
    return "platega";
  }

  if (getBooleanSetting(settings, "yoomoney_enabled", true) && isYooMoneyConfigured(settings)) {
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

async function applyPaymentSuccess(input: {
  paidAt?: Date;
  paymentId: string;
  providerPaymentId?: string | null;
  providerStatus?: string | null;
}) {
  const settings = await getSettingMap();

  const payment = await prisma.payment.findUnique({
    where: {
      id: input.paymentId
    }
  });

  if (!payment) {
    throw new Error("Платеж не найден.");
  }

  if (payment.status === "PAID") {
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
  };

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: {
        id: payment.id
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
        template: true
      }
    });

    if (!router) {
      return;
    }

    const currentSubscription =
      router.subscriptions.find((subscription) => subscription.status === "ACTIVE") ??
      router.subscriptions.find((subscription) => subscription.status === "PENDING_ACTIVATION") ??
      router.subscriptions[0] ??
      null;
    const accessEnabled = snapshot.accessEnabled ?? router.template?.accessEnabled ?? false;
    const supportType = snapshot.supportType ?? router.template?.supportType ?? "NONE";
    const requiresActivation =
      snapshot.requiresActivation ??
      (router.configurationType === "BASIC" && (accessEnabled || supportType === "EXTENDED"));
    const periodDays = getNumericSetting(settings, "subscription_period_days", 30);
    const now = new Date();
    const activeEndAt = currentSubscription?.endAt ?? null;
    const nextEndAt = new Date(
      (activeEndAt && activeEndAt.getTime() > now.getTime() ? activeEndAt : now).getTime() +
        periodDays * 24 * 60 * 60 * 1000
    );

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
          priceSnapshot: payment.amount,
          startAt: currentSubscription.startAt ?? now,
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
        priceSnapshot: payment.amount,
        routerId: payment.routerId,
        startAt: now,
        status: requiresActivation ? "PENDING_ACTIVATION" : "ACTIVE",
        supportType
      }
    });
  });

  await recordAdminAction({
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
    status: "PAID"
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

  if (payment.status === "PAID") {
    return {
      paymentId: payment.id,
      status: payment.status
    };
  }

  const snapshot = (payment.payloadSnapshot ?? {}) as Record<string, unknown>;
  await prisma.payment.update({
    where: {
      id: payment.id
    },
    data: {
      providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
      payloadSnapshot: {
        ...snapshot,
        providerStatus: input.providerStatus ?? null
      } as Prisma.InputJsonValue,
      status: input.status
    }
  });

  await recordAdminAction({
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
    name: user.name,
    email: getPrimaryEmail(user.identities),
    telegram: getTelegramIdentity(user.identities),
    telegramUsername: telegramIdentity?.email?.replace(/^@+/, "") ?? null,
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
      periodDays: getNumericSetting(settings, "subscription_period_days", 30),
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

export async function buildClientOverview(input: { currentSessionId?: string; userId: string }) {
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
        },
        notifications: {
          orderBy: {
            createdAt: "desc"
          },
          take: 8
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

  const recommendedTemplate = getRecommendedTemplate();
  const recommendedPrice = calculateBundlePrice(settings, recommendedTemplate);
  const localLogin = getLocalIdentity(user.identities);
  const routerCards = user.routers.map((router) => {
    const currentSubscription =
      router.subscriptions.find((subscription) => subscription.status === "ACTIVE") ??
      router.subscriptions.find((subscription) => subscription.status === "PENDING_ACTIVATION") ??
      router.subscriptions[0] ??
      null;
    const savedTemplate = router.template ?? currentSubscription ?? {
      accessEnabled: false,
      supportType: "NONE" as const
    };
    const nextPrice = calculateBundlePrice(settings, savedTemplate);

    return {
      id: router.id,
      displayName: router.displayName,
      model: router.model,
      serialNumber: router.serialNumber,
      configurationType: router.configurationType,
      status: router.status,
      adminNote: router.adminNote,
      currentPackage: describeBundle(savedTemplate),
      currentSubscription: currentSubscription
        ? {
            accessEnabled: currentSubscription.accessEnabled,
            supportType: currentSubscription.supportType,
            status: currentSubscription.status,
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
        label: describeBundle(savedTemplate),
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
        category: ticket.category,
        status: ticket.status,
        updatedAt: ticket.updatedAt.toISOString()
      })),
      trial: router.trial
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
      name: user.name ?? "Клиент FoxPoint",
      email: getPrimaryEmail(user.identities),
      telegram: getTelegramIdentity(user.identities),
      localLogin,
      createdAt: user.createdAt.toISOString(),
      lastActivityAt: user.lastActivityAt?.toISOString() ?? null,
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
      unreadNotificationCount: user.notifications.filter((notification) => !notification.readAt).length
    },
    catalog: {
      periodDays: getNumericSetting(settings, "subscription_period_days", 30),
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
      category: ticket.category,
      description: ticket.description,
      status: ticket.status,
      routerId: ticket.routerId,
      adminComment: ticket.adminComment,
      adminCommentUpdatedAt: ticket.adminCommentUpdatedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString()
    })),
    payments: user.payments.map((payment) => ({
      id: payment.id,
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
    notifications: user.notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      createdAt: notification.createdAt.toISOString(),
      readAt: notification.readAt?.toISOString() ?? null
    }))
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

export async function markClientNotificationsRead(input: { userId: string }) {
  const readAt = new Date();
  const result = await prisma.notification.updateMany({
    where: {
      userId: input.userId,
      readAt: null
    },
    data: {
      readAt
    }
  });

  return {
    readAt: readAt.toISOString(),
    updatedCount: result.count
  };
}

export async function clearClientNotificationFeed(input: { userId: string }) {
  const clearedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const notifications = await tx.notification.updateMany({
      where: {
        userId: input.userId,
        readAt: null
      },
      data: {
        readAt: clearedAt
      }
    });

    await tx.user.update({
      where: {
        id: input.userId
      },
      data: {
        notificationFeedClearedAt: clearedAt
      }
    });

    return notifications;
  });

  return {
    clearedAt: clearedAt.toISOString(),
    updatedCount: result.count
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

  const ticket = await prisma.supportTicket.create({
    data: {
      userId: input.userId,
      routerId: input.routerId ?? null,
      category: input.category.trim(),
      description: input.description.trim()
    }
  });

  return {
    ticketId: ticket.id
  };
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
      description: requestMeta.description
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
    }
  });

  if (!router) {
    throw new Error("Роутер не найден.");
  }

  const nextPrice = calculateBundlePrice(settings, input);
  await prisma.subscriptionTemplate.upsert({
    where: {
      routerId: input.routerId
    },
    update: {
      accessEnabled: input.accessEnabled,
      supportType: input.supportType,
      periodDays: getNumericSetting(settings, "subscription_period_days", 30),
      currentPrice: nextPrice
    },
    create: {
      routerId: input.routerId,
      accessEnabled: input.accessEnabled,
      supportType: input.supportType,
      periodDays: getNumericSetting(settings, "subscription_period_days", 30),
      currentPrice: nextPrice
    }
  });

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

  const activeTemplate =
    router.template ??
    router.subscriptions.find((subscription) => subscription.status === "ACTIVE") ?? {
      accessEnabled: false,
      supportType: "NONE" as const
    };
  const amount = calculateBundlePrice(settings, activeTemplate);
  const provider = resolveRequestedPaymentProvider(settings, input.provider);
  const description = `Продление обслуживания: ${router.displayName}`;

  if (amount <= 0) {
    throw new Error("Сначала выберите пакет для продления.");
  }

  const requiresActivation =
    router.configurationType === "BASIC" &&
    (activeTemplate.supportType === "EXTENDED" || activeTemplate.accessEnabled);

  const payment = await prisma.payment.create({
    data: {
      userId: input.userId,
      routerId: input.routerId,
      provider,
      amount,
      status: "CREATED",
      payloadSnapshot: {
        description,
        type: "subscription_renewal",
        routerId: input.routerId,
        accessEnabled: activeTemplate.accessEnabled,
        supportType: activeTemplate.supportType,
        requiresActivation
      }
    }
  });

  let paymentUrl = buildPaymentUrl(links.support, "renewal", input.routerId);
  let providerPaymentId: string | null = null;
  let payloadSnapshot = {
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

export async function buildAdminOverview(input: { clientQuery?: string | null } = {}) {
  const clientQuery = normalizeAdminClientQuery(input.clientQuery);
  const clientSearchWhere = buildAdminClientSearchWhere(clientQuery);
  const userRelationInclude = {
    identities: true,
    routers: {
      select: {
        id: true
      }
    }
  } satisfies Prisma.UserInclude;
  const [settings, users, clients, clientCount, routers, subscriptions, orders, tickets, rewards, logs] = await Promise.all([
    getAdminSettings(),
    prisma.user.findMany({
      include: userRelationInclude,
      orderBy: {
        createdAt: "desc"
      },
      take: 200
    }),
    prisma.user.findMany({
      where: clientSearchWhere,
      include: userRelationInclude,
      orderBy: {
        createdAt: "desc"
      },
      take: clientQuery ? 50 : 12
    }),
    prisma.user.count({
      where: clientSearchWhere
    }),
    prisma.router.findMany({
      include: {
        owner: {
          select: {
            id: true,
            name: true
          }
        },
        template: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 12
    }),
    prisma.subscription.findMany({
      include: {
        router: {
          select: {
            displayName: true
          }
        }
      },
      orderBy: {
        endAt: "asc"
      },
      take: 12
    }),
    prisma.routerOrder.findMany({
      include: {
        user: {
          select: {
            name: true,
            id: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 12
    }),
    prisma.supportTicket.findMany({
      include: {
        user: {
          select: {
            name: true
          }
        },
        router: {
          select: {
            displayName: true
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 12
    }),
    prisma.referralReward.findMany({
      orderBy: {
        createdAt: "desc"
      },
      take: 12
    }),
    prisma.adminAuditLog.findMany({
      orderBy: {
        createdAt: "desc"
      },
      take: 12
    })
  ]);

  return {
    clientCount,
    clientQuery,
    stats: {
      users: await prisma.user.count(),
      routers: await prisma.router.count(),
      activeSubscriptions: await prisma.subscription.count({
        where: {
          status: "ACTIVE"
        }
      }),
      openTickets: await prisma.supportTicket.count({
        where: {
          status: {
            not: "CLOSED"
          }
        }
      })
    },
    settings,
    users: users.map(mapAdminUserRecord),
    clients: clients.map(mapAdminUserRecord),
    routers: routers.map((router) => ({
      id: router.id,
      displayName: router.displayName,
      model: router.model,
      serialNumber: router.serialNumber,
      configurationType: router.configurationType,
      status: router.status,
      ownerId: router.owner.id,
      ownerName: router.owner.name ?? router.owner.id,
      savedTemplate: router.template ? describeBundle(router.template) : "Не выбран",
      adminNote: router.adminNote,
      createdAt: router.createdAt.toISOString()
    })),
    subscriptions: subscriptions.map((subscription) => ({
      id: subscription.id,
      routerId: subscription.routerId,
      routerName: subscription.router.displayName,
      bundleLabel: describeBundle(subscription),
      status: subscription.status,
      startAt: subscription.startAt?.toISOString() ?? null,
      endAt: subscription.endAt?.toISOString() ?? null,
      price: toNumber(subscription.priceSnapshot),
      priceLabel: formatMoney(toNumber(subscription.priceSnapshot)),
      accessEnabled: subscription.accessEnabled,
      supportType: subscription.supportType,
      pendingActivation: subscription.pendingActivation
    })),
    orders: orders.map((order) => ({
      id: order.id,
      userId: order.userId,
      customerName: order.user.name ?? order.user.id,
      status: order.status,
      totalPrice: toNumber(order.totalPrice),
      totalPriceLabel: formatMoney(toNumber(order.totalPrice)),
      trackingNumber: order.trackingNumber,
      createdAt: order.createdAt.toISOString(),
      receivedAt: order.receivedAt?.toISOString() ?? null
    })),
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      userId: ticket.userId,
      routerId: ticket.routerId,
      customerName: ticket.user.name ?? "Клиент",
      routerName: ticket.router?.displayName ?? "Без роутера",
      category: ticket.category,
      description: ticket.description,
      status: ticket.status,
      assigneeId: ticket.assigneeId,
      adminComment: ticket.adminComment,
      adminCommentUpdatedAt: ticket.adminCommentUpdatedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString()
    })),
    rewards: rewards.map((reward) => ({
      id: reward.id,
      amount: toNumber(reward.amount),
      amountLabel: formatMoney(toNumber(reward.amount)),
      status: reward.status,
      sourceType: reward.sourceType,
      createdAt: reward.createdAt.toISOString()
    })),
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      createdAt: log.createdAt.toISOString()
    }))
  };
}

export async function updateAdminTicket(input: {
  adminComment?: string | null;
  assigneeId?: string | null;
  status: TicketStatus;
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

  const nextAdminComment = input.adminComment?.trim() || null;
  const updated = await prisma.supportTicket.update({
    where: {
      id: input.ticketId
    },
    data: {
      status: input.status,
      assigneeId: input.assigneeId?.trim() || null,
      adminComment: nextAdminComment,
      adminCommentUpdatedAt: nextAdminComment !== ticket.adminComment ? (nextAdminComment ? new Date() : null) : ticket.adminCommentUpdatedAt
    }
  });

  await recordAdminAction({
    action: "ticket_updated",
    entityType: "SupportTicket",
    entityId: updated.id,
    beforeData: {
      status: ticket.status,
      assigneeId: ticket.assigneeId,
      adminComment: ticket.adminComment
    },
    afterData: {
      status: updated.status,
      assigneeId: updated.assigneeId,
      adminComment: updated.adminComment
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

  await prisma.supportTicket.delete({
    where: {
      id: input.ticketId
    }
  });

  await recordAdminAction({
    action: "ticket_deleted",
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
  const updated = await prisma.routerOrder.update({
    where: {
      id: input.orderId
    },
    data: {
      status: input.status,
      trackingNumber: nextTrackingNumber,
      receivedAt: shouldMarkReceived ? order.receivedAt ?? new Date() : order.receivedAt
    }
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

export async function updateAdminRouter(input: {
  adminNote?: string | null;
  configurationType: ConfigurationType;
  ownerUserId: string;
  routerId: string;
  status: RouterStatus;
}) {
  const [router, owner] = await Promise.all([
    prisma.router.findUnique({
      where: {
        id: input.routerId
      }
    }),
    prisma.user.findUnique({
      where: {
        id: input.ownerUserId
      }
    })
  ]);

  if (!router) {
    throw new Error("Роутер не найден.");
  }

  if (!owner) {
    throw new Error("Новый владелец не найден.");
  }

  const updated = await prisma.router.update({
    where: {
      id: input.routerId
    },
    data: {
      ownerUserId: input.ownerUserId,
      configurationType: input.configurationType,
      status: input.status,
      adminNote: input.adminNote?.trim() || null
    }
  });

  await recordAdminAction({
    action: "router_updated",
    entityType: "Router",
    entityId: updated.id,
    beforeData: {
      ownerUserId: router.ownerUserId,
      configurationType: router.configurationType,
      status: router.status,
      adminNote: router.adminNote
    },
    afterData: {
      ownerUserId: updated.ownerUserId,
      configurationType: updated.configurationType,
      status: updated.status,
      adminNote: updated.adminNote
    }
  });

  return {
    routerId: updated.id
  };
}

export async function updateAdminSubscription(input: {
  endAt?: string | null;
  pendingActivation: boolean;
  startAt?: string | null;
  status: SubscriptionStatus;
  subscriptionId: string;
}) {
  const subscription = await prisma.subscription.findUnique({
    where: {
      id: input.subscriptionId
    }
  });

  if (!subscription) {
    throw new Error("Подписка не найдена.");
  }

  const nextStartAt = input.startAt?.trim() ? new Date(input.startAt) : null;
  const nextEndAt = input.endAt?.trim() ? new Date(input.endAt) : null;

  if (nextStartAt && Number.isNaN(nextStartAt.getTime())) {
    throw new Error("Некорректная дата начала.");
  }

  if (nextEndAt && Number.isNaN(nextEndAt.getTime())) {
    throw new Error("Некорректная дата окончания.");
  }

  const updated = await prisma.subscription.update({
    where: {
      id: input.subscriptionId
    },
    data: {
      status: input.status,
      startAt: nextStartAt,
      endAt: nextEndAt,
      pendingActivation: input.pendingActivation
    }
  });

  await recordAdminAction({
    action: "subscription_updated",
    entityType: "Subscription",
    entityId: updated.id,
    beforeData: {
      status: subscription.status,
      startAt: subscription.startAt?.toISOString() ?? null,
      endAt: subscription.endAt?.toISOString() ?? null,
      pendingActivation: subscription.pendingActivation
    },
    afterData: {
      status: updated.status,
      startAt: updated.startAt?.toISOString() ?? null,
      endAt: updated.endAt?.toISOString() ?? null,
      pendingActivation: updated.pendingActivation
    }
  });

  return {
    subscriptionId: updated.id
  };
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
  status: UserStatus;
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

  if (nextTelegramUsername && !existingTelegramIdentity) {
    throw new Error("Нельзя указать Telegram без уже привязанного Telegram-аккаунта клиента.");
  }

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
        status: input.status
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
      email: existingEmail,
      telegramUsername: existingTelegramUsername,
      status: user.status
    },
    afterData: {
      name: updated.user.name,
      email: updated.email,
      telegramUsername: updated.telegramUsername,
      status: updated.user.status
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
  const periodDays = getNumericSetting(settings, "subscription_period_days", 30);
  const trialDays = getNumericSetting(settings, "trial_period_days", 14);
  const templatePrice = calculateBundlePrice(settings, input);
  const price = input.startTrial ? 0 : templatePrice;

  const router = await prisma.$transaction(async (tx) => {
    const createdRouter = await tx.router.create({
      data: {
        ownerUserId: input.userId,
        displayName: input.displayName.trim(),
        model: input.model?.trim() || null,
        serialNumber: input.serialNumber?.trim() || null,
        configurationType: input.configurationType,
        status: "ACTIVE",
        adminNote: input.adminNote?.trim() || null
      }
    });

    await tx.subscriptionTemplate.create({
      data: {
        routerId: createdRouter.id,
        accessEnabled: input.accessEnabled,
        supportType: input.supportType,
        periodDays,
        currentPrice: templatePrice
      }
    });

    if (input.accessEnabled || input.supportType !== "NONE") {
      await tx.subscription.create({
        data: {
          routerId: createdRouter.id,
          accessEnabled: input.accessEnabled,
          supportType: input.supportType,
          status: "ACTIVE",
          startAt: now,
          endAt: new Date(now.getTime() + (input.startTrial ? trialDays : periodDays) * 24 * 60 * 60 * 1000),
          priceSnapshot: price,
          pendingActivation:
            input.configurationType === "BASIC" &&
            (input.accessEnabled || input.supportType === "EXTENDED")
        }
      });
    }

    if (input.startTrial) {
      await tx.trial.create({
        data: {
          routerId: createdRouter.id,
          used: true,
          startAt: now,
          endAt: new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000),
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
