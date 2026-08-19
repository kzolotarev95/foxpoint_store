import { fetchApiJson } from "../lib/api";

type OverviewResponse = {
  links: {
    support: string;
    telegramBot: string;
    telegramChannel: string;
  };
};

export async function getEntryLinks() {
  try {
    const overview = await fetchApiJson<OverviewResponse>("/api/overview");
    return overview.links;
  } catch {
    return {
      telegramBot: process.env.NEXT_PUBLIC_TG_BOT_URL ?? "https://t.me/example_bot",
      telegramChannel: process.env.NEXT_PUBLIC_TG_CHANNEL_URL ?? "https://t.me/example_channel",
      support: process.env.SUPPORT_CONTACT ?? "@foxpoint_support"
    };
  }
}

export const dashboardSections = [
  "Мои роутеры",
  "Подписки и оплата",
  "Заказать роутер",
  "Поддержка",
  "Пригласить и заработать",
  "История платежей",
  "Профиль",
  "Telegram"
];
