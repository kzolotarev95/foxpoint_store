import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "../../../lib/api";
import { getClientCookieName, getClientSessionMaxAge } from "../../../lib/client-auth";
import { getSessionCookieOptions } from "../../../lib/session-cookie";
import { getTelegramCallbackPayload, resolveTelegramAppBaseUrl } from "../../../lib/telegram-auth";

async function buildPublicUrl(request: NextRequest, path: string) {
  const baseUrl = await resolveTelegramAppBaseUrl({
    requestHeaders: request.headers
  });

  return new URL(path, baseUrl);
}

async function redirectToLogin(request: NextRequest, errorMessage: string, referralCode?: string) {
  const location = await buildPublicUrl(request, "/login");
  location.searchParams.set("error", errorMessage);

  if (referralCode) {
    location.searchParams.set("ref", referralCode);
  }

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
  const referralCode = request.nextUrl.searchParams.get("ref")?.trim() ?? "";
  const payload = getTelegramCallbackPayload(request.nextUrl.searchParams);

  if (!payload) {
    return redirectToLogin(request, "Telegram не передал данные для входа.", referralCode || undefined);
  }

  const response = await fetch(`${getApiBaseUrl()}/api/auth/telegram`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
      ...getForwardedHeaders(request)
    },
    body: JSON.stringify({
      ...payload,
      referralCode: referralCode || undefined
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    return redirectToLogin(
      request,
      await parseApiError(response, "Не удалось выполнить вход через Telegram."),
      referralCode || undefined
    );
  }

  const result = (await response.json()) as { isNew: boolean; token: string };
  const target = await buildPublicUrl(request, result.isNew ? "/cabinet/routers?welcome=1" : "/cabinet/routers");
  const nextResponse = NextResponse.redirect(target);

  nextResponse.cookies.set({
    name: getClientCookieName(),
    value: result.token,
    ...(await getSessionCookieOptions(getClientSessionMaxAge()))
  });

  return nextResponse;
}
