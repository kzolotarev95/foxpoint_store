import { getPublicSettingLinks } from "./admin-settings.js";

export type OverviewResponse = {
  product: string;
  generatedAt: string;
  deploymentTarget: string;
  links: {
    appUrl: string;
    telegramBot: string;
    telegramChannel: string;
    support: string;
  };
  corePrinciples: string[];
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
    ]
  };
}
