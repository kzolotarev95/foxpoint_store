const DEFAULT_APP_URL = "http://localhost:3000";

export type TelegramCallbackPayload = {
  authDate: string;
  firstName: string;
  hash: string;
  id: string;
  lastName?: string;
  photoUrl?: string;
  username?: string;
};

function normalizeTelegramPathSegment(value: string): string | null {
  const normalized = value.trim().replace(/^@+/, "").replace(/\/+$/, "");
  return normalized || null;
}

export function getTelegramBotUsername(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("example_bot")) {
    return null;
  }

  if (trimmed.startsWith("@")) {
    return normalizeTelegramPathSegment(trimmed);
  }

  try {
    const parsed = new URL(trimmed);
    return normalizeTelegramPathSegment(parsed.pathname.split("/").filter(Boolean)[0] ?? "");
  } catch {
    return normalizeTelegramPathSegment(trimmed);
  }
}

function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL).replace(/\/+$/, "");
}

export function buildTelegramCallbackUrl(path: "login" | "link", input?: { referralCode?: string }): string {
  const url = new URL(`/telegram/${path}`, getAppBaseUrl());
  const referralCode = input?.referralCode?.trim() ?? "";

  if (path === "login" && referralCode) {
    url.searchParams.set("ref", referralCode);
  }

  return url.toString();
}

export function getTelegramCallbackPayload(searchParams: URLSearchParams): TelegramCallbackPayload | null {
  const authDate = searchParams.get("auth_date")?.trim() ?? "";
  const firstName = searchParams.get("first_name")?.trim() ?? "";
  const hash = searchParams.get("hash")?.trim() ?? "";
  const id = searchParams.get("id")?.trim() ?? "";

  if (!authDate || !firstName || !hash || !id) {
    return null;
  }

  const lastName = searchParams.get("last_name")?.trim() ?? "";
  const photoUrl = searchParams.get("photo_url")?.trim() ?? "";
  const username = searchParams.get("username")?.trim().replace(/^@+/, "") ?? "";

  return {
    authDate,
    firstName,
    hash,
    id,
    lastName: lastName || undefined,
    photoUrl: photoUrl || undefined,
    username: username || undefined
  };
}
