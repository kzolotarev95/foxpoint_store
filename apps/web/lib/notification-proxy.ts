import type { NextRequest } from "next/server";
import { getApiBaseUrl } from "./api";
import { getClientCookieName } from "./client-auth";

export async function proxyNotifications(request: NextRequest, action?: "read" | "clear") {
  const headers = { "Cache-Control": "no-store" };
  const token = request.cookies.get(getClientCookieName())?.value;
  if (!token) return Response.json({ error: "Сессия истекла. Войдите снова." }, { status: 401, headers });
  if (action) {
    let sameOrigin = false;
    try { sameOrigin = new URL(request.headers.get("origin") ?? "").host === request.headers.get("host"); } catch { /* Invalid origins are rejected. */ }
    if (!sameOrigin) return Response.json({ error: "Откройте уведомления из личного кабинета." }, { status: 403, headers });
  }
  const forwarded = new Headers({ Accept: "application/json", "content-type": "application/json", "x-client-session": token });
  if (request.headers.get("x-forwarded-for")) forwarded.set("x-client-forwarded-for", request.headers.get("x-forwarded-for")!);
  if (request.headers.get("user-agent")) forwarded.set("x-client-user-agent", request.headers.get("user-agent")!);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/me/notifications${action ? `/${action}` : ""}`, {
      method: action ? "POST" : "GET", headers: forwarded, cache: "no-store", signal: AbortSignal.timeout(8000),
      ...(action ? { body: await request.text() || "{}" } : {})
    });
    if (response.status >= 500) return Response.json({ error: "Не удалось обновить уведомления. Попробуйте ещё раз." }, { status: 503, headers });
    return new Response(response.body, { status: response.status, headers: { ...headers, "Content-Type": "application/json" } });
  } catch { return Response.json({ error: "Не удалось обновить уведомления. Попробуйте ещё раз." }, { status: 503, headers }); }
}
