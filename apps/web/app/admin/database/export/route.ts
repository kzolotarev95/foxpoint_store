import { cookies } from "next/headers";
import { getAdminCookieName, readAdminSession } from "../../../../lib/admin-auth";
import { getApiBaseUrl } from "../../../../lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = (await cookies()).get(getAdminCookieName())?.value;
  if (!readAdminSession(token)) return Response.json({ error: "Войдите в админ-панель." }, { status: 401 });
  const incoming = new URL(request.url);
  const query = new URLSearchParams(incoming.searchParams);
  if (!query.has("format")) query.set("format", "xlsx");
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/admin/database/export?${query.toString()}`, {
      cache: "no-store", headers: { "x-admin-session": token! }, signal: AbortSignal.timeout(30000)
    });
    return new Response(response.body, { status: response.status, headers: {
      "content-type": response.headers.get("content-type") ?? "text/csv; charset=utf-8",
      "content-disposition": response.headers.get("content-disposition") ?? 'attachment; filename="foxpoint-client-database.csv"',
      "cache-control": "no-store"
    } });
  } catch {
    return Response.json({ error: "Выгрузка временно недоступна." }, { status: 503 });
  }
}
