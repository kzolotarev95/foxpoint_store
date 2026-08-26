import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "../../../lib/api";
import { getAdminCookieName } from "../../../lib/admin-auth";
import { resolveTelegramAppBaseUrl } from "../../../lib/telegram-auth";

async function buildPublicUrl(request: NextRequest, path: string) {
  const baseUrl = await resolveTelegramAppBaseUrl({
    requestHeaders: request.headers
  });

  return new URL(path, baseUrl);
}

function getReturnToPath(value: FormDataEntryValue | null): string {
  const candidate = String(value ?? "").trim();

  if (!candidate.startsWith("/admin")) {
    return "/admin";
  }

  return candidate;
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

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const returnTo = getReturnToPath(formData.get("returnTo"));
  const token = request.cookies.get(getAdminCookieName())?.value ?? "";

  if (!token) {
    const location = await buildPublicUrl(request, "/admin/login");
    location.searchParams.set("error", "Сессия истекла. Войдите снова.");
    return NextResponse.redirect(location, { status: 303 });
  }

  const settings = Object.fromEntries(
    Array.from(formData.entries())
      .filter(([key]) => key !== "returnTo")
      .map(([key, value]) => [key, typeof value === "string" ? value : ""])
  );

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/api/admin/settings`, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "content-type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
        "x-admin-session": token
      },
      body: JSON.stringify({ settings }),
      cache: "no-store"
    });
  } catch {
    return redirectToTarget(request, returnTo, "error", "Не удалось сохранить настройки.");
  }

  if (response.status === 401) {
    const location = await buildPublicUrl(request, "/admin/login");
    location.searchParams.set("error", "Сессия истекла. Войдите снова.");
    return NextResponse.redirect(location, { status: 303 });
  }

  if (!response.ok) {
    return redirectToTarget(
      request,
      returnTo,
      "error",
      await parseApiError(response, "Не удалось сохранить настройки.")
    );
  }

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/login");
  revalidatePath("/cabinet");
  revalidatePath("/cabinet/payments");
  revalidatePath("/cabinet/routers");

  return redirectToTarget(request, returnTo, "success", "Настройки сохранены.");
}
