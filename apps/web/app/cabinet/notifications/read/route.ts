import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api";
import { getClientCookieName } from "../../../../lib/client-auth";
import { resolveTelegramAppBaseUrl } from "../../../../lib/telegram-auth";

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

async function buildPublicUrl(request: NextRequest, path: string) {
  const baseUrl = await resolveTelegramAppBaseUrl({
    requestHeaders: request.headers
  });

  return new URL(path, baseUrl);
}

async function redirectToTarget(
  request: NextRequest,
  returnTo: string,
  key: "error" | "success",
  message: string
) {
  const location = await buildPublicUrl(request, returnTo);
  location.searchParams.set(key, message);
  return NextResponse.redirect(location, { status: 303 });
}

function getReturnToPath(value: FormDataEntryValue | null): string {
  const candidate = String(value ?? "").trim();

  if (!candidate.startsWith("/cabinet")) {
    return "/cabinet/profile";
  }

  return candidate;
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const returnTo = getReturnToPath(formData.get("returnTo"));
  const token = request.cookies.get(getClientCookieName())?.value ?? "";

  if (!token) {
    const location = await buildPublicUrl(request, "/login");
    location.searchParams.set("error", "Сессия истекла. Войдите снова.");
    return NextResponse.redirect(location, { status: 303 });
  }

  const response = await fetch(`${getApiBaseUrl()}/api/me/notifications/read`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      cookie: request.headers.get("cookie") ?? "",
      "x-client-session": token,
      ...getForwardedHeaders(request)
    },
    cache: "no-store"
  });

  if (response.status === 401) {
    const location = await buildPublicUrl(request, "/login");
    location.searchParams.set("error", "Сессия истекла. Войдите снова.");
    return NextResponse.redirect(location, { status: 303 });
  }

  if (!response.ok) {
    return redirectToTarget(
      request,
      returnTo,
      "error",
      await parseApiError(response, "Не удалось отметить уведомления прочитанными.")
    );
  }

  return redirectToTarget(request, returnTo, "success", "Уведомления отмечены как прочитанные.");
}
