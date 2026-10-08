import type { NextRequest } from "next/server";
import { getAdminCookieName, readAdminSession } from "../../../lib/admin-auth";
import { getApiBaseUrl } from "../../../lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(getAdminCookieName())?.value;
  if (!readAdminSession(token)) return Response.json({ error: "Войдите в админ-панель." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/admin/server-metrics`, { cache: "no-store", headers: { "x-admin-session": token! }, signal: AbortSignal.timeout(5000) });
    return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Показатели сервера временно недоступны." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
