import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "../../../lib/api";
import { getClientCookieName } from "../../../lib/client-auth";
import { getTelegramCallbackPayload } from "../../../lib/telegram-auth";

function redirectToProfile(request: NextRequest, key: "error" | "success", message: string) {
  const location = new URL("/cabinet/profile", request.url);
  location.searchParams.set(key, message);
  return NextResponse.redirect(location);
}

function getForwardedHeaders(request: NextRequest): Record<string, string> {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";
  const result: Record<string, string> = {};

  if (forwardedFor) {
    result["x-client-forwarded-for"] = forwardedFor;
  }

  if (userAgent) {
    result["x-client-user-agent"] = userAgent;
  }

  return result;
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export async function GET(request: NextRequest) {
  const payload = getTelegramCallbackPayload(request.nextUrl.searchParams);
  const token = request.cookies.get(getClientCookieName())?.value ?? "";

  if (!token) {
    const location = new URL("/login", request.url);
    location.searchParams.set("error", "Сессия истекла. Войдите снова.");
    return NextResponse.redirect(location);
  }

  if (!payload) {
    return redirectToProfile(request, "error", "Telegram не передал данные для привязки.");
  }

  const response = await fetch(`${getApiBaseUrl()}/api/me/profile/telegram`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      "x-client-session": token,
      ...getForwardedHeaders(request)
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  if (response.status === 401) {
    const location = new URL("/login", request.url);
    location.searchParams.set("error", "Сессия истекла. Войдите снова.");
    return NextResponse.redirect(location);
  }

  if (!response.ok) {
    return redirectToProfile(request, "error", await parseApiError(response, "Не удалось привязать Telegram."));
  }

  return redirectToProfile(request, "success", "Telegram привязан к кабинету.");
}
