import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./api";
import { getExpiredSessionCookieOptions, getSessionCookieOptions } from "./session-cookie";

const CLIENT_COOKIE_NAME = "foxpoint_client_session";
const CLIENT_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function getClientCookieName(): string {
  return CLIENT_COOKIE_NAME;
}

export function getClientSessionMaxAge(): number {
  return CLIENT_SESSION_MAX_AGE;
}

export async function getClientSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(CLIENT_COOKIE_NAME)?.value ?? null;
}

export async function setClientSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set({
    name: CLIENT_COOKIE_NAME,
    value: token,
    ...(await getSessionCookieOptions(CLIENT_SESSION_MAX_AGE))
  });
}

export async function clearClientSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set({
    name: CLIENT_COOKIE_NAME,
    ...(await getExpiredSessionCookieOptions())
  });
}

export async function getClientRequestHeaders(): Promise<Headers> {
  const token = await getClientSessionToken();

  if (!token) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  return new Headers({
    Accept: "application/json",
    cookie: cookieStore.toString(),
    "x-client-session": token
  });
}

export async function fetchClientApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(Object.fromEntries((await getClientRequestHeaders()).entries()) ?? {}),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (response.status === 401) {
    redirect("/login?error=Сессия%20истекла.%20Войдите%20снова.");
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `API request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}
