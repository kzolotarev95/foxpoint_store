import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { config } from "./config.js";

const CLIENT_COOKIE_NAME = "foxpoint_client_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type ClientSessionPayload = {
  exp: number;
  u: string;
};

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", config.CLIENT_SESSION_SECRET).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseSessionPayload(encodedPayload: string): ClientSessionPayload | null {
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as ClientSessionPayload;
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeReferralCode(value: string): string {
  return value.trim().toUpperCase();
}

export function getClientCookieName(): string {
  return CLIENT_COOKIE_NAME;
}

export function createClientSessionToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + SESSION_TTL_MS,
      u: userId
    } satisfies ClientSessionPayload)
  ).toString("base64url");

  return `${payload}.${signPayload(payload)}`;
}

export function readClientSessionToken(token: string | undefined): ClientSessionPayload | null {
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

  return payload;
}

export function getClientSessionFromRequest(request: FastifyRequest): ClientSessionPayload | null {
  const headerToken = Array.isArray(request.headers["x-client-session"])
    ? request.headers["x-client-session"][0]
    : request.headers["x-client-session"];
  const cookieToken = getCookieValue(request.headers.cookie, CLIENT_COOKIE_NAME) ?? undefined;

  return readClientSessionToken(headerToken ?? cookieToken);
}

export function buildReferralCode(userId: string): string {
  return `FOX-${userId.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase()}`;
}

async function resolveReferrerByCode(referralCode: string) {
  if (!referralCode) {
    return null;
  }

  const users = await prisma.user.findMany({
    select: {
      id: true
    }
  });
  const normalizedCode = normalizeReferralCode(referralCode);

  return users.find((user) => buildReferralCode(user.id) === normalizedCode) ?? null;
}

export async function upsertClientFromEmail(input: {
  email: string;
  name?: string;
  referralCode?: string;
}) {
  const email = normalizeEmail(input.email);
  const name = input.name?.trim() || null;
  const referralCode = input.referralCode?.trim() || "";

  const existingIdentity = await prisma.authIdentity.findFirst({
    where: {
      provider: "EMAIL",
      email
    },
    include: {
      user: true
    }
  });

  if (existingIdentity) {
    await prisma.user.update({
      where: {
        id: existingIdentity.userId
      },
      data: {
        name: existingIdentity.user.name || !name ? existingIdentity.user.name : name,
        lastActivityAt: new Date()
      }
    });

    return {
      isNew: false,
      token: createClientSessionToken(existingIdentity.userId),
      userId: existingIdentity.userId
    };
  }

  const referrer = await resolveReferrerByCode(referralCode);
  const createdUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        status: "ACTIVE",
        lastActivityAt: new Date()
      }
    });

    await tx.authIdentity.create({
      data: {
        userId: user.id,
        provider: "EMAIL",
        providerUserId: email,
        email,
        verifiedAt: new Date()
      }
    });

    if (referrer && referrer.id !== user.id) {
      await tx.referral.create({
        data: {
          referrerUserId: referrer.id,
          referredUserId: user.id,
          referralCode: normalizeReferralCode(referralCode),
          source: "site_email_mvp"
        }
      });
    }

    return user;
  });

  return {
    isNew: true,
    token: createClientSessionToken(createdUser.id),
    userId: createdUser.id
  };
}
