import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api";
import { getClientCookieName } from "../../../../lib/client-auth";

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const token = request.cookies.get(getClientCookieName())?.value ?? "";

  if (!token) {
    return NextResponse.json({ error: "Сессия истекла. Войдите снова." }, { status: 401 });
  }

  const response = await fetch(`${getApiBaseUrl()}/api/me/overview`, {
    headers: {
      Accept: "application/json",
      cookie: request.headers.get("cookie") ?? "",
      "x-client-session": token
    },
    cache: "no-store"
  });

  if (response.status === 401) {
    return NextResponse.json({ error: "Сессия истекла. Войдите снова." }, { status: 401 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: await parseApiError(response, "Не удалось обновить чат.") }, { status: response.status });
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
