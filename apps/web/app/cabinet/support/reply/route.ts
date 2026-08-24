import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api";
import { getClientCookieName } from "../../../../lib/client-auth";
import { resolveTelegramAppBaseUrl } from "../../../../lib/telegram-auth";

async function buildPublicUrl(request: NextRequest, path: string) {
  const baseUrl = await resolveTelegramAppBaseUrl({
    requestHeaders: request.headers
  });

  return new URL(path, baseUrl);
}

function getReturnToPath(value: FormDataEntryValue | null): string {
  const candidate = String(value ?? "").trim();

  if (!candidate.startsWith("/cabinet")) {
    return "/cabinet/support";
  }

  return candidate;
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

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const returnTo = getReturnToPath(formData.get("returnTo"));
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const token = request.cookies.get(getClientCookieName())?.value ?? "";

  if (!token) {
    const location = await buildPublicUrl(request, "/login");
    location.searchParams.set("error", "Сессия истекла. Войдите снова.");
    return NextResponse.redirect(location, { status: 303 });
  }

  if (!ticketId) {
    return redirectToTarget(request, returnTo, "error", "Тикет не найден.");
  }

  if (message.length < 1) {
    return redirectToTarget(request, returnTo, "error", "Напишите сообщение.");
  }

  const response = await fetch(`${getApiBaseUrl()}/api/support/${encodeURIComponent(ticketId)}/messages`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      "x-client-session": token
    },
    body: JSON.stringify({
      message
    }),
    cache: "no-store"
  });

  if (response.status === 401) {
    const location = await buildPublicUrl(request, "/login");
    location.searchParams.set("error", "Сессия истекла. Войдите снова.");
    return NextResponse.redirect(location, { status: 303 });
  }

  if (!response.ok) {
    return redirectToTarget(request, returnTo, "error", await parseApiError(response, "Не удалось отправить сообщение."));
  }

  return redirectToTarget(request, returnTo, "success", "Сообщение отправлено.");
}
