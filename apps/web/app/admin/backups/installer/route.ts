import { cookies } from "next/headers";
import { getAdminCookieName, readAdminSession } from "../../../../lib/admin-auth";
import { getApiBaseUrl } from "../../../../lib/api";

export const runtime = "nodejs";
export async function GET() {
  const token = (await cookies()).get(getAdminCookieName())?.value;
  if (!readAdminSession(token)) return Response.json({ error: "Войдите в админ-панель." }, { status: 401 });
  const response = await fetch(`${getApiBaseUrl()}/api/admin/backups/installer`, { cache: "no-store", headers: { "x-admin-session": token! } });
  return new Response(response.body, { status: response.status, headers: { "content-type": "application/x-sh", "content-disposition": 'attachment; filename="restore-foxpoint.sh"', "cache-control": "no-store" } });
}
