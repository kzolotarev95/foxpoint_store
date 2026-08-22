import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import { readAdminSession, readAdminSessionToken } from "./admin-auth.js";
import {
  bindTelegramIdentityForUser,
  getClientSessionFromRequest,
  loginClientFromCredentials,
  loginClientFromTelegram,
  registerClientFromCredentials,
  revokeClientSessionForUser,
  revokeCurrentClientSession,
  upsertClientFromEmail
} from "./client-auth.js";
import { getAdminSettings, saveAdminSettings } from "./admin-settings.js";
import { config } from "./config.js";
import { buildOverview } from "./overview.js";
import {
  buildAdminOverview,
  buildClientOverview,
  buildSiteSnapshot,
  buildYooMoneyCheckoutHtml,
  createProfileRequestForUser,
  createAdminRouterAssignment,
  createRenewalPaymentForUser,
  createRouterOrderForUser,
  createSupportTicketForUser,
  handlePlategaCallback,
  handleYooMoneyCallback,
  attachEmailForUser,
  saveLocalCredentialsForUser,
  updateAdminOrder,
  updateAdminReward,
  updateAdminRouter,
  updateAdminSubscription,
  updateAdminTicket,
  updateRouterTemplateForUser
} from "./portal.js";
import { prisma } from "./prisma.js";

const app = Fastify({
  logger: true
});

function hasAdminSession(headers: { cookie?: string; "x-admin-session"?: string | string[] }): boolean {
  const headerToken = Array.isArray(headers["x-admin-session"])
    ? headers["x-admin-session"][0]
    : headers["x-admin-session"];

  return Boolean(readAdminSession(headers.cookie) || readAdminSessionToken(headerToken));
}

function isLocalAdminRequest(request: FastifyRequest): boolean {
  const remoteAddress = request.socket.remoteAddress ?? "";
  return request.ip === "127.0.0.1" || request.ip === "::1" || remoteAddress === "127.0.0.1" || remoteAddress === "::1";
}

function isAuthorizedAdminRequest(request: FastifyRequest): boolean {
  return isLocalAdminRequest(request) || hasAdminSession(request.headers);
}

async function getAuthorizedUserId(request: FastifyRequest): Promise<string | null> {
  return (await getClientSessionFromRequest(request))?.u ?? null;
}

const telegramAuthSchema = z.object({
  authDate: z.string().trim().regex(/^\d+$/),
  firstName: z.string().trim().min(1).max(120),
  hash: z.string().trim().length(64),
  id: z.string().trim().regex(/^\d+$/),
  lastName: z.string().trim().max(120).optional(),
  photoUrl: z.string().trim().url().max(512).optional(),
  referralCode: z.string().trim().max(32).optional(),
  username: z.string().trim().max(64).optional()
});

await app.register(cors, {
  origin: [config.NEXT_PUBLIC_APP_URL],
  credentials: true
});

await app.register(sensible);

app.addContentTypeParser(
  /^application\/x-www-form-urlencoded(?:\s*;.*)?$/i,
  { parseAs: "string" },
  (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string).entries()));
  }
);

app.get("/health", async () => {
  let database = "not_checked";

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  return {
    ok: true,
    service: "@foxpoint/api",
    environment: config.NODE_ENV,
    database,
    timestamp: new Date().toISOString()
  };
});

app.get("/api/overview", async () => {
  return buildOverview();
});

app.get("/api/site", async () => {
  return buildSiteSnapshot();
});

app.get("/api/routes", async () => {
  return {
    public: ["/health", "/api/overview", "/api/site", "/api/routes", "/api/auth/email", "/api/auth/credentials", "/api/auth/telegram"],
    planned: [
      "/api/me/overview",
      "/api/me/profile/telegram",
      "/api/orders",
      "/api/support",
      "/api/routers/:routerId/template",
      "/api/routers/:routerId/renew",
      "/api/admin/overview",
      "/api/admin/routers"
    ]
  };
});

app.post("/api/auth/telegram", async (request, reply) => {
  const body = telegramAuthSchema.parse(request.body);

  try {
    const result = await loginClientFromTelegram({
      authDate: body.authDate,
      firstName: body.firstName,
      hash: body.hash,
      id: body.id,
      lastName: body.lastName,
      photoUrl: body.photoUrl,
      referralCode: body.referralCode,
      request,
      username: body.username
    });
    reply.code(result.isNew ? 201 : 200);
    return result;
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось выполнить вход через Telegram."
    };
  }
});

app.post("/api/auth/email", async (request, reply) => {
  const body = z
    .object({
      email: z.string().email(),
      name: z.string().trim().min(2).max(80).optional(),
      referralCode: z.string().trim().max(32).optional()
    })
    .parse(request.body);

  const result = await upsertClientFromEmail({
    ...body,
    request
  });
  reply.code(result.isNew ? 201 : 200);
  return result;
});

app.post("/api/auth/credentials", async (request, reply) => {
  const body = z
    .object({
      mode: z.enum(["login", "register"]),
      login: z
        .string()
        .trim()
        .min(3)
        .max(32)
        .regex(/^[a-zA-Z0-9._-]+$/),
      password: z.string().min(6).max(128),
      referralCode: z.string().trim().max(32).optional()
    })
    .parse(request.body);

  try {
    const result =
      body.mode === "register"
        ? await registerClientFromCredentials({
            login: body.login,
            password: body.password,
            referralCode: body.referralCode,
            request
          })
        : await loginClientFromCredentials({
            login: body.login,
            password: body.password,
            request
          });
    reply.code(result.isNew ? 201 : 200);
    return result;
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось выполнить вход."
    };
  }
});

app.get("/api/me/overview", async (request, reply) => {
  const session = await getClientSessionFromRequest(request);
  if (!session) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  return buildClientOverview({
    userId: session.u,
    currentSessionId: session.sid
  });
});

app.post("/api/me/profile/email", async (request, reply) => {
  const userId = await getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const body = z
    .object({
      email: z.string().trim().email()
    })
    .parse(request.body);

  try {
    return await attachEmailForUser({
      userId,
      email: body.email
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось привязать email."
    };
  }
});

app.post("/api/me/profile/telegram", async (request, reply) => {
  const userId = await getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const body = telegramAuthSchema.parse(request.body);

  try {
    return await bindTelegramIdentityForUser({
      authDate: body.authDate,
      firstName: body.firstName,
      hash: body.hash,
      id: body.id,
      lastName: body.lastName,
      photoUrl: body.photoUrl,
      userId,
      username: body.username
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось привязать Telegram."
    };
  }
});

app.post("/api/me/profile/password", async (request, reply) => {
  const userId = await getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const body = z
    .object({
      login: z
        .string()
        .trim()
        .min(3)
        .max(32)
        .regex(/^[a-zA-Z0-9._-]+$/),
      password: z.string().min(6).max(128)
    })
    .parse(request.body);

  try {
    return await saveLocalCredentialsForUser({
      userId,
      login: body.login,
      password: body.password
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось сохранить логин и пароль."
    };
  }
});

app.post("/api/me/profile/request", async (request, reply) => {
  const userId = await getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const body = z
    .object({
      kind: z.enum(["DELETE_ACCOUNT", "TWO_FACTOR"])
    })
    .parse(request.body);

  try {
    return await createProfileRequestForUser({
      userId,
      kind: body.kind
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось создать запрос."
    };
  }
});

app.post("/api/orders", async (request, reply) => {
  const userId = await getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const body = z
    .object({
      provider: z.string().trim().min(1).optional()
    })
    .catch({
      provider: undefined
    })
    .parse(request.body ?? {});

  try {
    return await createRouterOrderForUser({
      userId,
      provider: body.provider
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось создать заказ."
    };
  }
});

app.post("/api/me/logout", async (request, reply) => {
  const userId = await getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  await revokeCurrentClientSession(request);
  return {
    ok: true
  };
});

app.post("/api/me/sessions/:sessionId/revoke", async (request, reply) => {
  const userId = await getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const params = z.object({ sessionId: z.string().trim().min(1) }).parse(request.params);

  try {
    return await revokeClientSessionForUser({
      userId,
      sessionId: params.sessionId
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось завершить сессию."
    };
  }
});

app.post("/api/support", async (request, reply) => {
  const userId = await getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const body = z
    .object({
      category: z.string().trim().min(2).max(120),
      description: z.string().trim().min(10).max(3000),
      routerId: z.string().trim().min(1).optional()
    })
    .parse(request.body);

  try {
    return await createSupportTicketForUser({
      userId,
      category: body.category,
      description: body.description,
      routerId: body.routerId
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось создать обращение."
    };
  }
});

app.post("/api/routers/:routerId/template", async (request, reply) => {
  const userId = await getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const params = z.object({ routerId: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      accessEnabled: z.boolean(),
      supportType: z.enum(["NONE", "BASIC", "EXTENDED"])
    })
    .parse(request.body);

  try {
    return await updateRouterTemplateForUser({
      userId,
      routerId: params.routerId,
      accessEnabled: body.accessEnabled,
      supportType: body.supportType
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось обновить пакет."
    };
  }
});

app.post("/api/routers/:routerId/renew", async (request, reply) => {
  const userId = await getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const params = z.object({ routerId: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      provider: z.string().trim().min(1).optional()
    })
    .catch({
      provider: undefined
    })
    .parse(request.body ?? {});

  try {
    return await createRenewalPaymentForUser({
      userId,
      routerId: params.routerId,
      provider: body.provider
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось создать продление."
    };
  }
});

app.get("/api/payments/:paymentId/checkout", async (request, reply) => {
  const params = z.object({ paymentId: z.string().trim().min(1) }).parse(request.params);

  try {
    const html = await buildYooMoneyCheckoutHtml(params.paymentId);
    reply.type("text/html; charset=utf-8");
    return html;
  } catch (error) {
    reply.code(404);
    reply.type("text/plain; charset=utf-8");
    return error instanceof Error ? error.message : "Страница оплаты не найдена.";
  }
});

app.post("/api/payments/platega/callback", async (request, reply) => {
  const body = z
    .object({
      amount: z.coerce.number(),
      id: z.string().trim().min(1),
      status: z.string().trim().min(1)
    })
    .parse(request.body);

  try {
    await handlePlategaCallback({
      amount: body.amount,
      merchantIdHeader: request.headers["x-merchantid"] as string | undefined,
      providerPaymentId: body.id,
      secretHeader: request.headers["x-secret"] as string | undefined,
      status: body.status
    });
    return {
      ok: true
    };
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Platega callback rejected."
    };
  }
});

app.post("/api/payments/yoomoney/callback", async (request, reply) => {
  const body = z.record(z.string(), z.string()).parse(request.body);

  try {
    await handleYooMoneyCallback(body);
    return {
      ok: true
    };
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "YooMoney callback rejected."
    };
  }
});

app.get("/api/admin/settings", async (request, reply) => {
  if (!isAuthorizedAdminRequest(request)) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  return {
    settings: await getAdminSettings()
  };
});

app.get("/api/admin/overview", async (request, reply) => {
  if (!isAuthorizedAdminRequest(request)) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  return buildAdminOverview();
});

app.put("/api/admin/settings", async (request, reply) => {
  if (!isAuthorizedAdminRequest(request)) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const body = z
    .object({
      settings: z.record(z.string(), z.string())
    })
    .parse(request.body);

  try {
    return {
      settings: await saveAdminSettings(body.settings)
    };
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Unable to save settings."
    };
  }
});

app.post("/api/admin/routers", async (request, reply) => {
  if (!isAuthorizedAdminRequest(request)) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const body = z
    .object({
      userId: z.string().trim().min(1),
      displayName: z.string().trim().min(2).max(120),
      model: z.string().trim().max(120).optional(),
      serialNumber: z.string().trim().max(120).optional(),
      configurationType: z.enum(["BASIC", "EXTENDED"]),
      accessEnabled: z.boolean(),
      supportType: z.enum(["NONE", "BASIC", "EXTENDED"]),
      startTrial: z.boolean().default(false),
      adminNote: z.string().trim().max(1000).optional()
    })
    .parse(request.body);

  try {
    return await createAdminRouterAssignment(body);
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось привязать роутер."
    };
  }
});

app.post("/api/admin/tickets/:ticketId", async (request, reply) => {
  if (!isAuthorizedAdminRequest(request)) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const params = z.object({ ticketId: z.string().trim().min(1) }).parse(request.params);
  const body = z
    .object({
      status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "RESOLVED", "CLOSED"]),
      assigneeId: z.string().trim().max(120).optional()
    })
    .parse(request.body);

  try {
    return await updateAdminTicket({
      ticketId: params.ticketId,
      status: body.status,
      assigneeId: body.assigneeId
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось обновить обращение."
    };
  }
});

app.post("/api/admin/orders/:orderId", async (request, reply) => {
  if (!isAuthorizedAdminRequest(request)) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const params = z.object({ orderId: z.string().trim().min(1) }).parse(request.params);
  const body = z
    .object({
      status: z.enum(["CREATED", "WAITING_PAYMENT", "PAID", "CONFIGURING", "READY_TO_SHIP", "SHIPPED", "RECEIVED", "CANCELED", "REFUND"]),
      trackingNumber: z.string().trim().max(120).optional()
    })
    .parse(request.body);

  try {
    return await updateAdminOrder({
      orderId: params.orderId,
      status: body.status,
      trackingNumber: body.trackingNumber
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось обновить заказ."
    };
  }
});

app.post("/api/admin/routers/:routerId", async (request, reply) => {
  if (!isAuthorizedAdminRequest(request)) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const params = z.object({ routerId: z.string().trim().min(1) }).parse(request.params);
  const body = z
    .object({
      ownerUserId: z.string().trim().min(1),
      configurationType: z.enum(["BASIC", "EXTENDED"]),
      status: z.enum(["DRAFT", "ACTIVE", "SUSPENDED", "DISABLED"]),
      adminNote: z.string().trim().max(1000).optional()
    })
    .parse(request.body);

  try {
    return await updateAdminRouter({
      routerId: params.routerId,
      ownerUserId: body.ownerUserId,
      configurationType: body.configurationType,
      status: body.status,
      adminNote: body.adminNote
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось обновить роутер."
    };
  }
});

app.post("/api/admin/subscriptions/:subscriptionId", async (request, reply) => {
  if (!isAuthorizedAdminRequest(request)) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const params = z.object({ subscriptionId: z.string().trim().min(1) }).parse(request.params);
  const body = z
    .object({
      status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "PENDING_ACTIVATION", "PAUSED", "CANCELLED"]),
      startAt: z.string().trim().max(40).optional(),
      endAt: z.string().trim().max(40).optional(),
      pendingActivation: z.boolean()
    })
    .parse(request.body);

  try {
    return await updateAdminSubscription({
      subscriptionId: params.subscriptionId,
      status: body.status,
      startAt: body.startAt,
      endAt: body.endAt,
      pendingActivation: body.pendingActivation
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось обновить подписку."
    };
  }
});

app.post("/api/admin/rewards/:rewardId", async (request, reply) => {
  if (!isAuthorizedAdminRequest(request)) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const params = z.object({ rewardId: z.string().trim().min(1) }).parse(request.params);
  const body = z
    .object({
      status: z.enum(["PENDING", "AVAILABLE", "CANCELED"])
    })
    .parse(request.body);

  try {
    return await updateAdminReward({
      rewardId: params.rewardId,
      status: body.status
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось обновить начисление."
    };
  }
});

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({
    host: config.API_HOST,
    port: config.API_PORT
  });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}
