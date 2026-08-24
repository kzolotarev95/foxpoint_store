import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "../../../../../lib/api";
import { getAdminCookieName } from "../../../../../lib/admin-auth";
import { resolveTelegramAppBaseUrl } from "../../../../../lib/telegram-auth";

async function buildPublicUrl(request: NextRequest, path: string) {
  const baseUrl = await resolveTelegramAppBaseUrl({
    requestHeaders: request.headers
  });

  return new URL(path, baseUrl);
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const token = request.cookies.get(getAdminCookieName())?.value ?? "";

  if (!token) {
    return NextResponse.json({ error: "Сессия истекла. Войдите снова." }, { status: 401 });
  }

  const response = await fetch(`${getApiBaseUrl()}/api/admin/overview`, {
    headers: {
      Accept: "application/json",
      cookie: request.headers.get("cookie") ?? "",
      "x-admin-session": token
    },
    cache: "no-store"
  });

  if (response.status === 401) {
    return NextResponse.json({ error: "Сессия истекла. Войдите снова." }, { status: 401 });
  }

  if (!response.ok) {
    const errorMessage = await parseApiError(response, "Не удалось обновить чат.");
    return NextResponse.json({ error: errorMessage }, { status: response.status });
  }

  const payload = (await response.json()) as { tickets?: Array<{ id: string; messages: unknown[]; status: string }> };
  const ticket = payload.tickets?.find((item) => item.id === ticketId);

  if (!ticket) {
    return NextResponse.json({ error: "Тикет не найден." }, { status: 404 });
  }

  return NextResponse.json({
    messages: ticket.messages,
    status: ticket.status
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
  const { ticketId } = await params;
  const formData = await request.formData();
  const message = String(formData.get("message") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? `/admin#ticket-${ticketId}`).trim();
  const token = request.cookies.get(getAdminCookieName())?.value ?? "";

  if (!token) {
    if (wantsJson) {
      return NextResponse.json({ error: "Сессия истекла. Войдите снова." }, { status: 401 });
    }

    const location = await buildPublicUrl(request, "/admin/login");
    location.searchParams.set("error", "Сессия истекла. Войдите снова.");
    return NextResponse.redirect(location, { status: 303 });
  }

  if (!message) {
    if (wantsJson) {
      return NextResponse.json({ error: "Напишите сообщение." }, { status: 400 });
    }

    return redirectToTarget(request, returnTo, "error", "Напишите сообщение.");
  }

  const response = await fetch(`${getApiBaseUrl()}/api/admin/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      "x-admin-session": token
    },
    body: JSON.stringify({
      message
    }),
    cache: "no-store"
  });

  if (response.status === 401) {
    if (wantsJson) {
      return NextResponse.json({ error: "Сессия истекла. Войдите снова." }, { status: 401 });
    }

    const location = await buildPublicUrl(request, "/admin/login");
    location.searchParams.set("error", "Сессия истекла. Войдите снова.");
    return NextResponse.redirect(location, { status: 303 });
  }

  if (!response.ok) {
    const errorMessage = await parseApiError(response, "Не удалось отправить сообщение.");
    if (wantsJson) {
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    return redirectToTarget(request, returnTo, "error", errorMessage);
  }

  const payload = (await response.json().catch(() => null)) as { body: string; createdAt: string; id: string } | null;

  if (wantsJson) {
    return NextResponse.json({
      message: payload,
      ok: true
    });
  }

  return redirectToTarget(request, returnTo, "success", "Сообщение отправлено.");
}
