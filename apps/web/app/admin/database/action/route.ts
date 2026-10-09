import { cookies } from "next/headers";
import { getAdminCookieName, readAdminSession } from "../../../../lib/admin-auth";
import { getApiBaseUrl } from "../../../../lib/api";
export async function POST(request: Request) {
  const token = (await cookies()).get(getAdminCookieName())?.value;
  if (!readAdminSession(token)) return Response.json({ error: "Войдите в админку." }, { status: 401 });
  const origin = request.headers.get("origin");
  let originHost = ""; try { originHost = origin ? new URL(origin).host : ""; } catch {}
  if (!originHost || originHost !== request.headers.get("host")) return Response.json({ error: "Откройте форму из админки." }, { status: 403 });
  const payload = await request.json().catch(() => null) as { path?: string; body?: unknown } | null;
  if (!payload?.path || !/^\/api\/admin\/(?:settings|users|routers|subscriptions|tickets|orders|rewards)(?:\/[a-zA-Z0-9_-]+(?:\/(credentials|delete|payments|reconcile|plan-change))?)?$/.test(payload.path)) return Response.json({ error: "Неизвестная операция." }, { status: 400 });
  try {
    const response = await fetch(`${getApiBaseUrl()}${payload.path}`, { method: payload.path==="/api/admin/settings"?"PUT":"POST", headers: { "x-admin-session": token!, "Content-Type": "application/json" }, body: JSON.stringify(payload.body ?? {}), cache: "no-store", signal: AbortSignal.timeout(30000) });
    return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Сбой соединения. Введённые данные остаются в форме." }, { status: 503 }); }
}
