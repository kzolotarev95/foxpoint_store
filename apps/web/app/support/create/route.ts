import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "../../../lib/api";
import { resolveTelegramAppBaseUrl } from "../../../lib/telegram-auth";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const routerCode = String(form.get("routerCode") ?? "").trim().toUpperCase();
  const location = new URL("/support", await resolveTelegramAppBaseUrl({ requestHeaders: request.headers }));
  location.searchParams.set("router", routerCode);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/public/support`, {
      method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
      body: JSON.stringify({ routerCode, description: String(form.get("description") ?? ""),
        contact: String(form.get("contact") ?? ""), website: String(form.get("website") ?? "") })
    });
    const payload = await response.json() as { number?: number; error?: string };
    location.searchParams.set(response.ok ? "success" : "error", response.ok
      ? `Обращение №${payload.number} отправлено. Поддержка ответит по указанному контакту.`
      : payload.error ?? "Не удалось отправить обращение.");
  } catch {
    location.searchParams.set("error", "Поддержка временно недоступна. Попробуйте ещё раз позже.");
  }
  return NextResponse.redirect(location, { status: 303 });
}
