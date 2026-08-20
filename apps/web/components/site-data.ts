import { fetchApiJson } from "../lib/api";

const FOXPOINT_SUPPORT_URL = "https://t.me/Fox_point_support";

export type PublicLinks = {
  appUrl: string;
  support: string;
  telegramBot: string;
  telegramChannel: string;
};

export type HealthResponse = {
  database: string;
  environment: string;
  ok: boolean;
  service: string;
  timestamp: string;
};

export type SiteSnapshot = {
  product: string;
  tagline: string;
  links: PublicLinks;
  trialPeriodDays: number;
  orderOffer: {
    routerPrice: number;
    routerPriceLabel: string;
    setupPrice: number;
    setupPriceLabel: string;
    totalPrice: number;
    totalPriceLabel: string;
  };
  subscriptionOffer: {
    periodDays: number;
    extendedAccessPrice: number;
    basicSupportPrice: number;
    extendedSupportPrice: number;
    recommendedPrice: number;
    recommendedPriceLabel: string;
    recommendedPackage: string;
  };
  referralOffer: {
    signupBonus: number;
    signupBonusLabel: string;
    subscriptionPercent: number;
  };
  corePrinciples: string[];
  journey: string[];
};

function normalizeTelegramUrl(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  if (trimmed.includes("example_bot") || trimmed.includes("example_channel")) {
    return fallback;
  }

  if (trimmed.startsWith("@")) {
    return `https://t.me/${trimmed.slice(1)}`;
  }

  return trimmed;
}

function normalizeAppUrl(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

export const defaultPublicLinks: PublicLinks = {
  appUrl: normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL ?? "", "http://localhost:3000"),
  telegramBot: normalizeTelegramUrl(process.env.NEXT_PUBLIC_TG_BOT_URL ?? "", "https://t.me/example_bot"),
  telegramChannel: normalizeTelegramUrl(process.env.NEXT_PUBLIC_TG_CHANNEL_URL ?? "", "https://t.me/fox_point_net"),
  support: FOXPOINT_SUPPORT_URL
};

const defaultSiteSnapshot: SiteSnapshot = {
  product: "Интернет, как раньше",
  tagline: "Готовые настроенные роутеры, личный кабинет и продление услуг без ручной переписки.",
  links: defaultPublicLinks,
  trialPeriodDays: 14,
  orderOffer: {
    routerPrice: 4499,
    routerPriceLabel: "4 499 ₽",
    setupPrice: 4999,
    setupPriceLabel: "4 999 ₽",
    totalPrice: 9498,
    totalPriceLabel: "9 498 ₽"
  },
  subscriptionOffer: {
    periodDays: 30,
    extendedAccessPrice: 999,
    basicSupportPrice: 999,
    extendedSupportPrice: 999,
    recommendedPrice: 1998,
    recommendedPriceLabel: "1 998 ₽",
    recommendedPackage: "Расширенный доступ + Расширенное сопровождение"
  },
  referralOffer: {
    signupBonus: 1000,
    signupBonusLabel: "1 000 ₽",
    subscriptionPercent: 10
  },
  corePrinciples: [
    "Сайт и Telegram используют общий backend и одну базу.",
    "Один клиент может видеть несколько роутеров в одном кабинете.",
    "Продление всегда привязано к конкретному устройству."
  ],
  journey: [
    "Открыть Telegram или сайт и выбрать удобный вход.",
    "Проверить роутеры, сроки и текущий пакет.",
    "Продлить подписку, заказать устройство или написать в поддержку."
  ]
};

export function isTelegramBotConfigured(url: string): boolean {
  return !url.includes("example_bot");
}

export async function getSiteSnapshot(): Promise<SiteSnapshot> {
  try {
    const snapshot = await fetchApiJson<SiteSnapshot>("/api/site");
    return {
      ...snapshot,
      links: {
        appUrl: normalizeAppUrl(snapshot.links.appUrl, defaultPublicLinks.appUrl),
        telegramBot: normalizeTelegramUrl(snapshot.links.telegramBot, defaultPublicLinks.telegramBot),
        telegramChannel: normalizeTelegramUrl(snapshot.links.telegramChannel, defaultPublicLinks.telegramChannel),
        support: FOXPOINT_SUPPORT_URL
      }
    };
  } catch {
    return defaultSiteSnapshot;
  }
}

export async function getEntryLinks(): Promise<PublicLinks> {
  const snapshot = await getSiteSnapshot();
  return snapshot.links;
}

export async function getSystemHealth(): Promise<HealthResponse> {
  try {
    return await fetchApiJson<HealthResponse>("/health");
  } catch {
    return {
      ok: false,
      service: "@foxpoint/api",
      environment: process.env.NODE_ENV ?? "unknown",
      database: "down",
      timestamp: new Date().toISOString()
    };
  }
}
