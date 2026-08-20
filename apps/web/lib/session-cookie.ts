import { headers } from "next/headers";

function isSecureUrl(value: string | null): boolean | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return null;
  }
}

async function shouldUseSecureCookiesForRequest(): Promise<boolean> {
  const headerStore = await headers();
  const forwardedProto = headerStore.get("x-forwarded-proto");

  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }

  const originSecure = isSecureUrl(headerStore.get("origin"));
  if (originSecure !== null) {
    return originSecure;
  }

  const refererSecure = isSecureUrl(headerStore.get("referer"));
  if (refererSecure !== null) {
    return refererSecure;
  }

  return (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");
}

export async function getSessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: await shouldUseSecureCookiesForRequest()
  };
}

export async function getExpiredSessionCookieOptions() {
  return {
    ...(await getSessionCookieOptions(0)),
    value: ""
  };
}
