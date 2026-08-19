import { fetchApiJson } from "../lib/api";

export type PublicLinks = {
  support: string;
  telegramBot: string;
  telegramChannel: string;
};

export type OverviewResponse = {
  corePrinciples: string[];
  currentScope: string[];
  deploymentTarget: string;
  generatedAt: string;
  links: {
    support: string;
    telegramBot: string;
    telegramChannel: string;
  };
  nextMilestones: string[];
  product: string;
};

export type HealthResponse = {
  database: string;
  environment: string;
  ok: boolean;
  service: string;
  timestamp: string;
};

export const defaultPublicLinks: PublicLinks = {
  telegramBot: process.env.NEXT_PUBLIC_TG_BOT_URL ?? "https://t.me/example_bot",
  telegramChannel: process.env.NEXT_PUBLIC_TG_CHANNEL_URL ?? "https://t.me/fox_point_net",
  support: process.env.SUPPORT_CONTACT ?? "https://t.me/Fox_point_support"
};

export function isTelegramBotConfigured(url: string): boolean {
  return !url.includes("example_bot");
}

export async function getEntryLinks(): Promise<PublicLinks> {
  try {
    const overview = await fetchApiJson<OverviewResponse>("/api/overview");
    return overview.links;
  } catch {
    return defaultPublicLinks;
  }
}

export async function getSiteOverview(): Promise<OverviewResponse> {
  try {
    return await fetchApiJson<OverviewResponse>("/api/overview");
  } catch {
    return {
      product: "FoxPoint",
      generatedAt: new Date().toISOString(),
      deploymentTarget: "VPS",
      links: defaultPublicLinks,
      corePrinciples: [
        "Сайт и Telegram используют один backend и одну базу данных",
        "Клиентские сценарии не должны обещать то, чего ещё нет в системе",
        "Публичные ссылки и контакты редактируются из админки"
      ],
      currentScope: [
        "Публичная главная страница",
        "Рабочая админка настроек",
        "Клиентский вход через Telegram-ссылки",
        "Backend и PostgreSQL на VPS"
      ],
      nextMilestones: [
        "Telegram-идентификация пользователя через bot token и callback",
        "Роутеры, подписки, платежи и обращения из реальных таблиц",
        "Персональный кабинет с данными конкретного клиента"
      ]
    };
  }
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

export const dashboardSections = [
  "Текущий доступ",
  "Ссылки и каналы",
  "Статус системы",
  "Что уже работает",
  "Что подключаем дальше"
];
