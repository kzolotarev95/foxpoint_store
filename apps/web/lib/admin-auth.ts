import { createHmac, timingSafeEqual } from "node:crypto";

const ADMIN_COOKIE_NAME = "foxpoint_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type AdminSessionPayload = {
  exp: number;
  u: string;
};

function getAdminConfig() {
  return {
    password: process.env.ADMIN_PASSWORD ?? "admin",
    secret: process.env.ADMIN_SESSION_SECRET ?? "foxpoint-admin-secret-change-me",
    username: process.env.ADMIN_USERNAME ?? "admin"
  };
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getAdminConfig().secret).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseSessionPayload(encodedPayload: string): AdminSessionPayload | null {
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AdminSessionPayload;
    if (typeof payload.u !== "string" || typeof payload.exp !== "number") {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getAdminCookieName(): string {
  return ADMIN_COOKIE_NAME;
}

export function getAdminSessionMaxAge(): number {
  return SESSION_TTL_SECONDS;
}

export function isAdminCredentialPairValid(username: string, password: string): boolean {
  const config = getAdminConfig();
  return username === config.username && password === config.password;
}

export function createAdminSessionToken(username: string): string {
  const encodedPayload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + SESSION_TTL_SECONDS * 1000,
      u: username
    } satisfies AdminSessionPayload)
  ).toString("base64url");

  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function readAdminSession(token: string | undefined): AdminSessionPayload | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  const payload = parseSessionPayload(encodedPayload);
  if (!payload || payload.exp <= Date.now()) {
    return null;
  }

  if (payload.u !== getAdminConfig().username) {
    return null;
  }

  return payload;
}

