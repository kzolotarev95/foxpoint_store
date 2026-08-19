import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const ADMIN_COOKIE_NAME = "foxpoint_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type AdminSessionPayload = {
  exp: number;
  u: string;
};

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", config.ADMIN_SESSION_SECRET).update(encodedPayload).digest("base64url");
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

function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(/;\s*/)) {
    const [cookieName, ...cookieValueParts] = part.split("=");
    if (cookieName === name) {
      return cookieValueParts.join("=");
    }
  }

  return null;
}

export function getAdminCookieName(): string {
  return ADMIN_COOKIE_NAME;
}

export function isAdminCredentialPairValid(username: string, password: string): boolean {
  return username === config.ADMIN_USERNAME && password === config.ADMIN_PASSWORD;
}

export function createAdminSessionToken(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + SESSION_TTL_MS,
      u: username
    } satisfies AdminSessionPayload)
  ).toString("base64url");

  return `${payload}.${signPayload(payload)}`;
}

export function readAdminSession(cookieHeader: string | undefined): AdminSessionPayload | null {
  const token = getCookieValue(cookieHeader, ADMIN_COOKIE_NAME);
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

  if (payload.u !== config.ADMIN_USERNAME) {
    return null;
  }

  return payload;
}

