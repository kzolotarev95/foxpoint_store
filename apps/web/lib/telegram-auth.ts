import { headers } from "next/headers";
import { fetchApiJson } from "./api";

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

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function getPublicBaseUrlFromHeaders(headerStore: Pick<Headers, "get">): string | null {
  const forwardedHost = headerStore.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  const host = forwardedHost || headerStore.get("host")?.trim() || "";

  if (!host) {
    return null;
  }

  const forwardedProto = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "";
  const proto = forwardedProto || (host.includes("localhost") ? "http" : "https");
  return normalizeBaseUrl(`${proto}://${host}`);
}

async function getConfiguredAppBaseUrl(): Promise<string | null> {
  try {
    const snapshot = await fetchApiJson<{ links?: { appUrl?: string } }>("/api/site");
    return normalizeBaseUrl(snapshot.links?.appUrl);
  } catch {
    return null;
  }
}

export async function resolveTelegramAppBaseUrl(input?: {
  fallbackAppUrl?: string | null;
  requestHeaders?: Pick<Headers, "get">;
}): Promise<string> {
  const requestBaseUrl = input?.requestHeaders ? getPublicBaseUrlFromHeaders(input.requestHeaders) : null;
  if (requestBaseUrl && !requestBaseUrl.includes("localhost")) {
    return requestBaseUrl;
  }

  const fallbackAppUrl = normalizeBaseUrl(input?.fallbackAppUrl);
  if (fallbackAppUrl) {
    return fallbackAppUrl;
  }

  const configuredAppUrl = await getConfiguredAppBaseUrl();
  if (configuredAppUrl) {
    return configuredAppUrl;
  }

  return requestBaseUrl ?? getAppBaseUrl();
}

export function buildTelegramCallbackUrl(path: "login" | "link", input?: { referralCode?: string }): string {
  const url = new URL(`/telegram/${path}`, getAppBaseUrl());
  const referralCode = input?.referralCode?.trim() ?? "";

  if (path === "login" && referralCode) {
    url.searchParams.set("ref", referralCode);
  }

  return url.toString();
}

async function getRequestBaseUrl(): Promise<string | null> {
  const headerStore = await headers();
  return getPublicBaseUrlFromHeaders(headerStore);
}

export async function buildTelegramCallbackUrlForRequest(
  path: "login" | "link",
  input?: { fallbackAppUrl?: string | null; referralCode?: string }
): Promise<string> {
  const requestBaseUrl = await getRequestBaseUrl();
  const baseUrl = requestBaseUrl && !requestBaseUrl.includes("localhost")
    ? requestBaseUrl
    : await resolveTelegramAppBaseUrl({
        fallbackAppUrl: input?.fallbackAppUrl
      });
  const url = new URL(`/telegram/${path}`, baseUrl);
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
