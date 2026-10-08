import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api";
import { getClientCookieName } from "../../../../lib/client-auth";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const token = request.cookies.get(getClientCookieName())?.value;
  const headers = { "Cache-Control": "no-store" };
  if (!token) return NextResponse.json({ error: "Сессия истекла. Войдите снова." }, { status: 401, headers });
  try {
    const forwarded = new Headers({ Accept: "application/json", "x-client-session": token });
    if (request.headers.get("user-agent")) forwarded.set("x-client-user-agent", request.headers.get("user-agent")!);
    if (request.headers.get("x-forwarded-for")) forwarded.set("x-client-forwarded-for", request.headers.get("x-forwarded-for")!);
    const response = await fetch(`${getApiBaseUrl()}/api/me/tickets/${encodeURIComponent(ticketId)}`, { headers: forwarded, cache: "no-store", signal: AbortSignal.timeout(8000) });
    const ticket = await response.json();
    if (!response.ok) return NextResponse.json({ error: ticket.error || "Не удалось обновить чат." }, { status: response.status, headers });
    return NextResponse.json({ messages: ticket.messages, status: ticket.status }, { headers });
  } catch { return NextResponse.json({ error: "Не удалось обновить чат." }, { status: 503, headers }); }
}
