import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { config } from "./config.js";
import { prisma } from "./prisma.js";

const CLIENT_COOKIE_NAME = "foxpoint_client_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SESSION_ACTIVITY_UPDATE_WINDOW_MS = 1000 * 60 * 5;

type ClientSessionPayload = {
  exp: number;
  sid: string;
  u: string;
};

type ClientRequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

export type TelegramAuthInput = {
  authDate: string;
  firstName: string;
  hash: string;
  id: string;
  lastName?: string;
  photoUrl?: string;
  username?: string;
};

export type VerifiedClientSession = ClientSessionPayload;

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
    if (typeof payload.u !== "string" || typeof payload.sid !== "string" || typeof payload.exp !== "number") {
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

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === "string" ? value : null;
}

function limitString(value: string | null | undefined, maxLength: number): string | null {
  if (!value) {
    return null;
  }

  return value.slice(0, maxLength);
}

function getRequestIpAddress(request: FastifyRequest): string | null {
  const forwarded = getHeaderValue(request.headers["x-client-forwarded-for"]) ?? getHeaderValue(request.headers["x-forwarded-for"]);
  const rawIp = forwarded?.split(",")[0]?.trim() || request.ip || request.socket.remoteAddress || "";

  return rawIp ? limitString(rawIp, 120) : null;
}

function getClientRequestContext(request: FastifyRequest): ClientRequestContext {
  return {
    ipAddress: getRequestIpAddress(request),
    userAgent: limitString(
      getHeaderValue(request.headers["x-client-user-agent"]) ?? getHeaderValue(request.headers["user-agent"]),
      500
    )
  };
}

function shouldRefreshSessionActivity(input: {
  currentIpAddress: string | null;
  currentUserAgent: string | null;
  lastSeenAt: Date;
  nextIpAddress: string | null;
  nextUserAgent: string | null;
}): boolean {
  if (Date.now() - input.lastSeenAt.getTime() >= SESSION_ACTIVITY_UPDATE_WINDOW_MS) {
    return true;
  }

  return input.currentIpAddress !== input.nextIpAddress || input.currentUserAgent !== input.nextUserAgent;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

function normalizeReferralCode(value: string): string {
  return value.trim().toUpperCase();
}

function createPasswordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password: string, passwordHash: string): boolean {
  const [algorithm, salt, storedHash] = passwordHash.split(":");
  if (algorithm !== "scrypt" || !salt || !storedHash) {
    return false;
  }

  const expectedLength = Buffer.from(storedHash, "hex").length;
  if (expectedLength === 0) {
    return false;
  }

  const actualHash = scryptSync(password, salt, expectedLength).toString("hex");
  return safeEqual(actualHash, storedHash);
}

function normalizeTelegramUserId(value: string): string {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error("Некорректный Telegram ID.");
  }

  return normalized;
}

function normalizeTelegramUsername(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^@+/, "") ?? "";
  if (!normalized) {
    return null;
  }

  if (!/^[a-zA-Z0-9_]{5,32}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function buildTelegramDisplayName(input: TelegramAuthInput): string | null {
  const fullName = [input.firstName.trim(), input.lastName?.trim() ?? ""].filter(Boolean).join(" ").trim();
  if (fullName) {
    return fullName;
  }

  return normalizeTelegramUsername(input.username);
}

function validateTelegramAuth(input: TelegramAuthInput) {
  const normalizedId = normalizeTelegramUserId(input.id);
  const normalizedUsername = normalizeTelegramUsername(input.username);
  const authDate = Number.parseInt(input.authDate, 10);

  if (!Number.isFinite(authDate)) {
    throw new Error("Некорректная дата авторизации Telegram.");
  }

  const authTimestampMs = authDate * 1000;
  const maxAgeMs = 1000 * 60 * 15;
  if (Math.abs(Date.now() - authTimestampMs) > maxAgeMs) {
    throw new Error("Telegram-авторизация устарела. Повторите вход.");
  }

  const dataCheckString = [
    ["auth_date", input.authDate],
    ["first_name", input.firstName],
    ["id", normalizedId],
    ["last_name", input.lastName?.trim() ?? ""],
    ["photo_url", input.photoUrl?.trim() ?? ""],
    ["username", normalizedUsername ?? ""]
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .sort((left, right) => left.localeCompare(right))
    .join("\n");

  const secret = createHash("sha256").update(config.TG_BOT_TOKEN).digest();
  const expectedHash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (!safeEqual(expectedHash, input.hash)) {
    throw new Error("Не удалось подтвердить Telegram-авторизацию.");
  }

  return {
    authDate: new Date(authTimestampMs),
    displayName: buildTelegramDisplayName({
      ...input,
      id: normalizedId,
      username: normalizedUsername ?? undefined
    }),
    id: normalizedId,
    username: normalizedUsername
  };
}

export function getClientCookieName(): string {
  return CLIENT_COOKIE_NAME;
}

function createClientSessionToken(input: { expiresAt: Date; sessionId: string; userId: string }): string {
  const payload = Buffer.from(
    JSON.stringify({
      exp: input.expiresAt.getTime(),
      sid: input.sessionId,
      u: input.userId
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

function getClientSessionTokenFromRequest(request: FastifyRequest): string | undefined {
  const headerToken = getHeaderValue(request.headers["x-client-session"]) ?? undefined;
  const cookieToken = getCookieValue(request.headers.cookie, CLIENT_COOKIE_NAME) ?? undefined;

  return headerToken ?? cookieToken;
}

async function createPersistedClientSession(input: { request: FastifyRequest; userId: string }) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const requestContext = getClientRequestContext(input.request);
  const session = await prisma.clientSession.create({
    data: {
      userId: input.userId,
      expiresAt,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent
    }
  });

  return {
    expiresAt,
    sessionId: session.id,
    token: createClientSessionToken({
      userId: input.userId,
      sessionId: session.id,
      expiresAt
    })
  };
}

async function createSessionResult(input: { isNew: boolean; request: FastifyRequest; userId: string }) {
  const session = await createPersistedClientSession({
    request: input.request,
    userId: input.userId
  });

  return {
    isNew: input.isNew,
    token: session.token,
    userId: input.userId
  };
}

export async function getClientSessionFromRequest(request: FastifyRequest): Promise<VerifiedClientSession | null> {
  const token = getClientSessionTokenFromRequest(request);
  const payload = readClientSessionToken(token);

  if (!payload) {
    return null;
  }

  const session = await prisma.clientSession.findUnique({
    where: {
      id: payload.sid
    }
  });

  if (!session || session.userId !== payload.u || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const requestContext = getClientRequestContext(request);
  if (
    shouldRefreshSessionActivity({
      currentIpAddress: session.ipAddress,
      currentUserAgent: session.userAgent,
      lastSeenAt: session.lastSeenAt,
      nextIpAddress: requestContext.ipAddress,
      nextUserAgent: requestContext.userAgent
    })
  ) {
    await prisma.clientSession.update({
      where: {
        id: session.id
      },
      data: {
        lastSeenAt: new Date(),
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent
      }
    });
  }

  return payload;
}

export async function listClientSessionsForUser(input: { currentSessionId?: string; userId: string }) {
  const sessions = await prisma.clientSession.findMany({
    where: {
      userId: input.userId,
      revokedAt: null,
      expiresAt: {
        gt: new Date()
      }
    },
    orderBy: [
      {
        lastSeenAt: "desc"
      },
      {
        createdAt: "desc"
      }
    ],
    take: 12
  });

  return sessions.map((session) => ({
    id: session.id,
    isCurrent: session.id === input.currentSessionId,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    userAgent: session.userAgent,
    ipAddress: session.ipAddress
  }));
}

export async function revokeClientSessionForUser(input: { sessionId: string; userId: string }) {
  const session = await prisma.clientSession.findFirst({
    where: {
      id: input.sessionId,
      userId: input.userId
    }
  });

  if (!session) {
    throw new Error("Сессия не найдена.");
  }

  if (session.revokedAt) {
    return {
      revoked: false
    };
  }

  await prisma.clientSession.update({
    where: {
      id: session.id
    },
    data: {
      revokedAt: new Date()
    }
  });

  return {
    revoked: true
  };
}

export async function revokeCurrentClientSession(request: FastifyRequest) {
  const payload = await getClientSessionFromRequest(request);

  if (!payload) {
    return {
      revoked: false
    };
  }

  return revokeClientSessionForUser({
    userId: payload.u,
    sessionId: payload.sid
  });
}

export function buildReferralCode(userId: string): string {
  return `FOX-${userId.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase()}`;
}

export function normalizeClientLogin(login: string): string {
  return normalizeLogin(login);
}

export async function bindEmailIdentityForUser(input: { email: string; userId: string }) {
  const email = normalizeEmail(input.email);

  const [user, existingIdentity, conflictingIdentity] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: input.userId
      }
    }),
    prisma.authIdentity.findFirst({
      where: {
        userId: input.userId,
        provider: "EMAIL"
      }
    }),
    prisma.authIdentity.findFirst({
      where: {
        provider: "EMAIL",
        email
      }
    })
  ]);

  if (!user) {
    throw new Error("Клиент не найден.");
  }

  if (conflictingIdentity && conflictingIdentity.userId !== input.userId) {
    throw new Error("Этот email уже используется в другом аккаунте.");
  }

  if (existingIdentity) {
    return prisma.authIdentity.update({
      where: {
        id: existingIdentity.id
      },
      data: {
        providerUserId: email,
        email,
        verifiedAt: existingIdentity.verifiedAt ?? new Date()
      }
    });
  }

  return prisma.$transaction(async (tx) => {
    const identity = await tx.authIdentity.create({
      data: {
        userId: input.userId,
        provider: "EMAIL",
        providerUserId: email,
        email,
        verifiedAt: new Date()
      }
    });

    await tx.user.update({
      where: {
        id: input.userId
      },
      data: {
        lastActivityAt: new Date()
      }
    });

    return identity;
  });
}

export async function upsertLocalCredentialsForUser(input: {
  login: string;
  password: string;
  userId: string;
}) {
  const login = normalizeLogin(input.login);
  const passwordHash = createPasswordHash(input.password);

  const [user, existingIdentity, conflictingIdentity] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: input.userId
      }
    }),
    prisma.authIdentity.findFirst({
      where: {
        userId: input.userId,
        provider: "LOCAL"
      }
    }),
    prisma.authIdentity.findFirst({
      where: {
        provider: "LOCAL",
        providerUserId: login
      }
    })
  ]);

  if (!user) {
    throw new Error("Клиент не найден.");
  }

  if (conflictingIdentity && conflictingIdentity.userId !== input.userId) {
    throw new Error("Такой логин уже занят.");
  }

  if (existingIdentity) {
    return prisma.$transaction(async (tx) => {
      const identity = await tx.authIdentity.update({
        where: {
          id: existingIdentity.id
        },
        data: {
          providerUserId: login,
          passwordHash,
          verifiedAt: existingIdentity.verifiedAt ?? new Date()
        }
      });

      await tx.user.update({
        where: {
          id: input.userId
        },
        data: {
          name: user.name ?? login,
          lastActivityAt: new Date()
        }
      });

      return identity;
    });
  }

  return prisma.$transaction(async (tx) => {
    const identity = await tx.authIdentity.create({
      data: {
        userId: input.userId,
        provider: "LOCAL",
        providerUserId: login,
        passwordHash,
        verifiedAt: new Date()
      }
    });

    await tx.user.update({
      where: {
        id: input.userId
      },
      data: {
        name: user.name ?? login,
        lastActivityAt: new Date()
      }
    });

    return identity;
  });
}

export async function bindTelegramIdentityForUser(input: TelegramAuthInput & { userId: string }) {
  const verified = validateTelegramAuth(input);

  const [user, existingIdentity, conflictingIdentity] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: input.userId
      }
    }),
    prisma.authIdentity.findFirst({
      where: {
        userId: input.userId,
        provider: "TELEGRAM"
      }
    }),
    prisma.authIdentity.findFirst({
      where: {
        provider: "TELEGRAM",
        providerUserId: verified.id
      }
    })
  ]);

  if (!user) {
    throw new Error("Клиент не найден.");
  }

  if (conflictingIdentity && conflictingIdentity.userId !== input.userId) {
    throw new Error("Этот Telegram уже привязан к другому аккаунту.");
  }

  const telegramData = {
    email: verified.username,
    providerUserId: verified.id,
    verifiedAt: verified.authDate
  };

  if (existingIdentity) {
    return prisma.$transaction(async (tx) => {
      const identity = await tx.authIdentity.update({
        where: {
          id: existingIdentity.id
        },
        data: telegramData
      });

      await tx.user.update({
        where: {
          id: input.userId
        },
        data: {
          lastActivityAt: new Date(),
          name: user.name ?? verified.displayName ?? user.name
        }
      });

      return identity;
    });
  }

  return prisma.$transaction(async (tx) => {
    const identity = await tx.authIdentity.create({
      data: {
        userId: input.userId,
        provider: "TELEGRAM",
        ...telegramData
      }
    });

    await tx.user.update({
      where: {
        id: input.userId
      },
      data: {
        lastActivityAt: new Date(),
        name: user.name ?? verified.displayName ?? user.name
      }
    });

    return identity;
  });
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

export async function loginClientFromTelegram(input: TelegramAuthInput & { referralCode?: string; request: FastifyRequest }) {
  const verified = validateTelegramAuth(input);
  const referralCode = input.referralCode?.trim() || "";

  const existingIdentity = await prisma.authIdentity.findFirst({
    where: {
      provider: "TELEGRAM",
      providerUserId: verified.id
    },
    include: {
      user: true
    }
  });

  if (existingIdentity) {
    await prisma.$transaction(async (tx) => {
      await tx.authIdentity.update({
        where: {
          id: existingIdentity.id
        },
        data: {
          email: verified.username,
          verifiedAt: verified.authDate
        }
      });

      await tx.user.update({
        where: {
          id: existingIdentity.userId
        },
        data: {
          lastActivityAt: new Date(),
          name: existingIdentity.user.name ?? verified.displayName ?? existingIdentity.user.name
        }
      });
    });

    return createSessionResult({
      isNew: false,
      request: input.request,
      userId: existingIdentity.userId
    });
  }

  const referrer = await resolveReferrerByCode(referralCode);
  const createdUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: verified.displayName,
        status: "ACTIVE",
        lastActivityAt: new Date()
      }
    });

    await tx.authIdentity.create({
      data: {
        userId: user.id,
        provider: "TELEGRAM",
        providerUserId: verified.id,
        email: verified.username,
        verifiedAt: verified.authDate
      }
    });

    if (referrer && referrer.id !== user.id) {
      await tx.referral.create({
        data: {
          referrerUserId: referrer.id,
          referredUserId: user.id,
          referralCode: normalizeReferralCode(referralCode),
          source: "site_telegram_mvp"
        }
      });
    }

    return user;
  });

  return createSessionResult({
    isNew: true,
    request: input.request,
    userId: createdUser.id
  });
}

export async function upsertClientFromEmail(input: {
  email: string;
  name?: string;
  referralCode?: string;
  request: FastifyRequest;
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

    return createSessionResult({
      isNew: false,
      request: input.request,
      userId: existingIdentity.userId
    });
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

  return createSessionResult({
    isNew: true,
    request: input.request,
    userId: createdUser.id
  });
}

export async function registerClientFromCredentials(input: {
  login: string;
  password: string;
  referralCode?: string;
  request: FastifyRequest;
}) {
  const login = normalizeLogin(input.login);
  const password = input.password;
  const referralCode = input.referralCode?.trim() || "";

  const existingIdentity = await prisma.authIdentity.findFirst({
    where: {
      provider: "LOCAL",
      providerUserId: login
    },
    include: {
      user: true
    }
  });

  if (existingIdentity) {
    throw new Error("Такой логин уже занят.");
  }

  const referrer = await resolveReferrerByCode(referralCode);
  const createdUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: login,
        status: "ACTIVE",
        lastActivityAt: new Date()
      }
    });

    await tx.authIdentity.create({
      data: {
        userId: user.id,
        provider: "LOCAL",
        providerUserId: login,
        passwordHash: createPasswordHash(password),
        verifiedAt: new Date()
      }
    });

    if (referrer && referrer.id !== user.id) {
      await tx.referral.create({
        data: {
          referrerUserId: referrer.id,
          referredUserId: user.id,
          referralCode: normalizeReferralCode(referralCode),
          source: "site_local_mvp"
        }
      });
    }

    return user;
  });

  return createSessionResult({
    isNew: true,
    request: input.request,
    userId: createdUser.id
  });
}

export async function loginClientFromCredentials(input: { login: string; password: string; request: FastifyRequest }) {
  const login = normalizeLogin(input.login);
  const password = input.password;

  const existingIdentity = await prisma.authIdentity.findFirst({
    where: {
      provider: "LOCAL",
      providerUserId: login
    }
  });

  if (!existingIdentity || !existingIdentity.passwordHash || !verifyPassword(password, existingIdentity.passwordHash)) {
    throw new Error("Неверный логин или пароль.");
  }

  await prisma.user.update({
    where: {
      id: existingIdentity.userId
    },
    data: {
      lastActivityAt: new Date()
    }
  });

  return createSessionResult({
    isNew: false,
    request: input.request,
    userId: existingIdentity.userId
  });
}
