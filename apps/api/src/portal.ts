import {
  ConfigurationType,
  OrderStatus,
  RewardStatus,
  RouterStatus,
  SubscriptionStatus,
  SupportType,
  TicketStatus,
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
  identities: Array<{ provider: string; providerUserId: string }>
): string | null {
  const telegramIdentity = identities.find((identity) => identity.provider === "TELEGRAM");
  return telegramIdentity ? `@${telegramIdentity.providerUserId}` : null;
}

function getLocalIdentity(
  identities: Array<{ provider: string; providerUserId: string }>
): string | null {
  return identities.find((identity) => identity.provider === "LOCAL")?.providerUserId ?? null;
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
      status: user.status,
      balance: toNumber(user.balance),
      balanceLabel: formatMoney(toNumber(user.balance)),
      referralCode: buildReferralCode(user.id),
      referralLink: `${config.NEXT_PUBLIC_APP_URL}/login?ref=${encodeURIComponent(buildReferralCode(user.id))}`,
      hasOpenTwoFactorRequest: Boolean(openTwoFactorRequest),
      hasOpenDeletionRequest: Boolean(openDeletionRequest)
    },
    sessions: clientSessions,
    links: {
      support: links.support,
      telegramBot: links.telegramBot,
      telegramChannel: links.telegramChannel
    },
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
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString()
    })),
    payments: user.payments.map((payment) => ({
      id: payment.id,
      amount: toNumber(payment.amount),
      amountLabel: formatMoney(toNumber(payment.amount)),
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

export async function createRouterOrderForUser(userId: string) {
  const [links, settings] = await Promise.all([getPublicSettingLinks(), getSettingMap()]);
  const routerPrice = getNumericSetting(settings, "router_price", 4499);
  const setupPrice = getNumericSetting(settings, "setup_price", 4999);
  const totalPrice = routerPrice + setupPrice;

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.routerOrder.create({
      data: {
        userId,
        routerPrice,
        setupPrice,
        totalPrice,
        status: "WAITING_PAYMENT"
      }
    });

    const payment = await tx.payment.create({
      data: {
        userId,
        orderId: order.id,
        provider: "manual_mvp",
        amount: totalPrice,
        status: "PENDING",
        paymentUrl: buildPaymentUrl(links.support, "order", order.id),
        payloadSnapshot: {
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

  return {
    orderId: result.order.id,
    paymentId: result.payment.id,
    paymentUrl: result.payment.paymentUrl,
    totalPrice,
    totalPriceLabel: formatMoney(totalPrice)
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
      provider: "manual_mvp",
      amount,
      status: "PENDING",
      paymentUrl: buildPaymentUrl(links.support, "renewal", input.routerId),
      payloadSnapshot: {
        type: "subscription_renewal",
        routerId: input.routerId,
        accessEnabled: activeTemplate.accessEnabled,
        supportType: activeTemplate.supportType,
        requiresActivation
      }
    }
  });

  return {
    paymentId: payment.id,
    paymentUrl: payment.paymentUrl,
    amount,
    amountLabel: formatMoney(amount),
    requiresActivation
  };
}

export async function buildAdminOverview() {
  const [settings, users, routers, subscriptions, orders, tickets, rewards, logs] = await Promise.all([
    getAdminSettings(),
    prisma.user.findMany({
      include: {
        identities: true,
        routers: {
          select: {
            id: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 12
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
    users: users.map((user) => ({
      id: user.id,
      name: user.name ?? "Без имени",
      email: getPrimaryEmail(user.identities) ?? "Нет email",
      telegram: getTelegramIdentity(user.identities),
      status: user.status,
      balance: toNumber(user.balance),
      balanceLabel: formatMoney(toNumber(user.balance)),
      routerCount: user.routers.length,
      referralCode: buildReferralCode(user.id),
      createdAt: user.createdAt.toISOString(),
      lastActivityAt: user.lastActivityAt?.toISOString() ?? null
    })),
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

  const updated = await prisma.supportTicket.update({
    where: {
      id: input.ticketId
    },
    data: {
      status: input.status,
      assigneeId: input.assigneeId?.trim() || null
    }
  });

  await recordAdminAction({
    action: "ticket_updated",
    entityType: "SupportTicket",
    entityId: updated.id,
    beforeData: {
      status: ticket.status,
      assigneeId: ticket.assigneeId
    },
    afterData: {
      status: updated.status,
      assigneeId: updated.assigneeId
    }
  });

  return {
    ticketId: updated.id
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
