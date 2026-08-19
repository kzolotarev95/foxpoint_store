import { getPublicSettingLinks } from "./admin-settings.js";

export type OverviewResponse = {
  product: string;
  generatedAt: string;
  deploymentTarget: string;
  links: {
    telegramBot: string;
    telegramChannel: string;
    support: string;
  };
  corePrinciples: string[];
  currentScope: string[];
  nextMilestones: string[];
};

export async function buildOverview(): Promise<OverviewResponse> {
  const links = await getPublicSettingLinks();

  return {
    product: "Интернет, как раньше",
    generatedAt: new Date().toISOString(),
    deploymentTarget: "VPS",
    links,
    corePrinciples: [
      "Сайт и Telegram-бот должны использовать единый backend и одну БД",
      "Один клиент может владеть несколькими роутерами",
      "Платежи и подписки всегда привязаны к конкретному роутеру",
      "Клиентский интерфейс скрывает внутренние технические термины"
    ],
    currentScope: [
      "Публичная главная страница",
      "Клиентский вход через Telegram-ссылки и поддержку",
      "Рабочая админ-панель настроек",
      "Схема БД под MVP",
      "API-основа для дальнейшей доменной логики"
    ],
    nextMilestones: [
      "Telegram auth через bot token, callback и привязку к пользователю",
      "CRUD для роутеров, подписок, заказов и платежей",
      "Реферальная логика и внутренний баланс",
      "Система поддержки и аудит админ-действий"
    ]
  };
}
