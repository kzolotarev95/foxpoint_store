export type TelegramBotStartAction = "login" | "link";

export function buildTelegramBotStartPayload(action: TelegramBotStartAction, referralCode?: string): string {
  const normalizedReferralCode = referralCode?.trim();
  return normalizedReferralCode ? `${action}:${normalizedReferralCode}` : action;
}

export function buildTelegramBotUrl(botUrl: string, action: TelegramBotStartAction, referralCode?: string): string {
  const normalizedBotUrl = botUrl.trim();

  try {
    const url = new URL(normalizedBotUrl);
    url.searchParams.set("start", buildTelegramBotStartPayload(action, referralCode));
    return url.toString();
  } catch {
    return normalizedBotUrl;
  }
}
