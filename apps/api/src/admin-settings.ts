import { config } from "./config.js";
import { prisma } from "./prisma.js";

export type AdminSettingInput = "number" | "text" | "url";

export type AdminSettingDefinition = {
  defaultValue: string;
  description: string;
  group: string;
  input: AdminSettingInput;
  key: string;
  label: string;
  public: boolean;
};

export type AdminSettingRecord = AdminSettingDefinition & {
  value: string;
};

type AppSettingKeyRow = {
  key: string;
};

type AppSettingRow = {
  key: string;
  value: string;
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

  try {
    return new URL(trimmed).toString();
  } catch {
    return fallback;
  }
}

const adminSettingDefinitions: AdminSettingDefinition[] = [
  {
    key: "router_price",
    label: "Цена роутера",
    description: "Стоимость готового устройства без прошивки и настройки.",
    group: "Продажи",
    input: "number",
    defaultValue: "4499",
    public: false
  },
  {
    key: "setup_price",
    label: "Цена прошивки и настройки",
    description: "Отдельная стоимость подготовки устройства перед отправкой.",
    group: "Продажи",
    input: "number",
    defaultValue: "4999",
    public: false
  },
  {
    key: "subscription_period_days",
    label: "Длительность периода, дней",
    description: "Базовый период продления подписки для быстрого продления.",
    group: "Подписки",
    input: "number",
    defaultValue: "30",
    public: false
  },
  {
    key: "extended_access_price",
    label: "Расширенный доступ",
    description: "Цена за один период расширенного доступа.",
    group: "Подписки",
    input: "number",
    defaultValue: "999",
    public: false
  },
  {
    key: "basic_support_price",
    label: "Базовое сопровождение",
    description: "Цена базового технического сопровождения за один период.",
    group: "Подписки",
    input: "number",
    defaultValue: "999",
    public: false
  },
  {
    key: "extended_support_price",
    label: "Расширенное сопровождение",
    description: "Цена расширенного технического сопровождения за один период.",
    group: "Подписки",
    input: "number",
    defaultValue: "999",
    public: false
  },
  {
    key: "trial_period_days",
    label: "Тестовый период, дней",
    description: "Сколько дней длится бесплатный старт после ручной активации.",
    group: "Пробный период",
    input: "number",
    defaultValue: "14",
    public: false
  },
  {
    key: "trial_package_name",
    label: "Название тестового пакета",
    description: "Как тестовый пакет будет называться в интерфейсах и уведомлениях.",
    group: "Пробный период",
    input: "text",
    defaultValue: "Интернет, как раньше+",
    public: false
  },
  {
    key: "referral_bonus_referrer",
    label: "Бонус пригласившему",
    description: "Сумма за подтверждённый заказ роутера для пригласившего.",
    group: "Рефералы",
    input: "number",
    defaultValue: "1000",
    public: false
  },
  {
    key: "referral_bonus_referred",
    label: "Бонус приглашённому",
    description: "Сумма за подтверждённый заказ роутера для нового клиента.",
    group: "Рефералы",
    input: "number",
    defaultValue: "1000",
    public: false
  },
  {
    key: "referral_subscription_percent",
    label: "Процент с подписок",
    description: "Процент вознаграждения с утверждённой базы платных подписок.",
    group: "Рефералы",
    input: "number",
    defaultValue: "10",
    public: false
  },
  {
    key: "referral_review_days",
    label: "Период проверки начислений, дней",
    description: "Через сколько дней реферальная награда становится доступной.",
    group: "Рефералы",
    input: "number",
    defaultValue: "14",
    public: false
  },
  {
    key: "support_contact",
    label: "Ссылка поддержки",
    description: "Публичная ссылка на поддержку, которую можно показывать на сайте и в клиентских сценариях.",
    group: "Коммуникации",
    input: "url",
    defaultValue: config.SUPPORT_CONTACT,
    public: true
  },
  {
    key: "tg_bot_url",
    label: "Ссылка на Telegram-бота",
    description: "Основная кнопка перехода в Telegram для новых и действующих клиентов.",
    group: "Коммуникации",
    input: "url",
    defaultValue: config.TG_BOT_URL,
    public: true
  },
  {
    key: "tg_channel_url",
    label: "Ссылка на Telegram-канал",
    description: "Публичный канал проекта для новостей и уведомлений.",
    group: "Коммуникации",
    input: "url",
    defaultValue: config.TG_CHANNEL_URL,
    public: true
  }
];

function normalizeValue(definition: AdminSettingDefinition, rawValue: string | undefined): string {
  const nextValue = (rawValue ?? "").trim();
  if (!nextValue) {
    throw new Error(`Setting "${definition.label}" is required.`);
  }

  if (definition.input === "number") {
    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Setting "${definition.label}" must be a non-negative number.`);
    }

    return String(parsed);
  }

  if (definition.input === "url") {
    return normalizeTelegramUrl(nextValue, definition.defaultValue);
  }

  return nextValue;
}

async function ensureSettingsSeeded(): Promise<void> {
  const knownKeys = adminSettingDefinitions.map((definition) => definition.key);
  const existingSettings = (await (prisma as any).appSetting.findMany({
    select: {
      key: true
    },
    where: {
      key: {
        in: knownKeys
      }
    }
  })) as AppSettingKeyRow[];

  const existingKeys = new Set(existingSettings.map((setting) => setting.key));
  const missingDefinitions = adminSettingDefinitions.filter((definition) => !existingKeys.has(definition.key));
  if (!missingDefinitions.length) {
    return;
  }

  await prisma.$transaction(
    missingDefinitions.map((definition) =>
      (prisma as any).appSetting.create({
        data: {
          key: definition.key,
          value: definition.defaultValue
        }
      })
    )
  );
}

export async function getAdminSettings(): Promise<AdminSettingRecord[]> {
  await ensureSettingsSeeded();

  const settings = (await (prisma as any).appSetting.findMany({
    where: {
      key: {
        in: adminSettingDefinitions.map((definition) => definition.key)
      }
    }
  })) as AppSettingRow[];

  const valueByKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  return adminSettingDefinitions.map((definition) => ({
    ...definition,
    value: valueByKey.get(definition.key) ?? definition.defaultValue
  }));
}

export async function getPublicSettingLinks(): Promise<{
  support: string;
  telegramBot: string;
  telegramChannel: string;
}> {
  const settings = await getAdminSettings();
  const valueByKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  return {
    telegramBot: normalizeTelegramUrl(valueByKey.get("tg_bot_url") ?? "", config.TG_BOT_URL),
    telegramChannel: normalizeTelegramUrl(
      valueByKey.get("tg_channel_url") ?? "",
      config.TG_CHANNEL_URL
    ),
    support: normalizeTelegramUrl(valueByKey.get("support_contact") ?? "", config.SUPPORT_CONTACT)
  };
}

export async function saveAdminSettings(values: Record<string, string>): Promise<AdminSettingRecord[]> {
  await ensureSettingsSeeded();

  await prisma.$transaction(
    adminSettingDefinitions.map((definition) =>
      (prisma as any).appSetting.upsert({
        where: {
          key: definition.key
        },
        update: {
          value: normalizeValue(definition, values[definition.key])
        },
        create: {
          key: definition.key,
          value: normalizeValue(definition, values[definition.key])
        }
      })
    )
  );

  return getAdminSettings();
}
