import type { NextRequest } from "next/server";
import { getAdminCookieName, readAdminSession } from "../../../../../lib/admin-auth";
import { getApiBaseUrl } from "../../../../../lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const token = request.cookies.get(getAdminCookieName())?.value;
  if (!readAdminSession(token)) return Response.json({ error: "Войдите в админ-панель." }, { status: 401 });
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    let sameOrigin = false;
    try { sameOrigin = Boolean(origin && new URL(origin).host === host); } catch { /* Invalid origins are rejected. */ }
    if (!sameOrigin) return Response.json({ error: "Запрос должен быть отправлен из админ-панели." }, { status: 403 });
  }
  const path = (await context.params).path ?? [];
  const route = path.join("/");
  if (!(route === "" || route === "upload" || /^[a-f0-9-]{36}\/(download|restore|delete)$/.test(route))) return Response.json({ error: "Раздел не найден." }, { status: 404 });
  const headers = new Headers({ "x-admin-session": token!, "content-type": request.headers.get("content-type") ?? "application/json" });
  if (route === "upload") headers.set("x-backup-password", request.headers.get("x-backup-password") ?? "");
  try {
    const options: RequestInit & { duplex?: "half" } = { method: request.method, headers, cache: "no-store" };
    if (request.method === "POST") { options.body = request.body; options.duplex = "half"; }
    const response = await fetch(`${getApiBaseUrl()}/api/admin/backups${route ? `/${route}` : ""}`, options);
    const returned = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "content-disposition", "content-length"]) {
      const value = response.headers.get(name);
      if (value) returned.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: returned });
  } catch { return Response.json({ error: "Не удалось связаться с сервисом бэкапов. Попробуйте ещё раз." }, { status: 503 }); }
}

export const GET = proxy;
export const POST = proxy;
