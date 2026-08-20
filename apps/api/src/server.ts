import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import { readAdminSession, readAdminSessionToken } from "./admin-auth.js";
import { getClientSessionFromRequest, loginClientFromCredentials, registerClientFromCredentials, upsertClientFromEmail } from "./client-auth.js";
import { getAdminSettings, saveAdminSettings } from "./admin-settings.js";
import { config } from "./config.js";
import { buildOverview } from "./overview.js";
import {
  buildAdminOverview,
  buildClientOverview,
  buildSiteSnapshot,
  createAdminRouterAssignment,
  createRenewalPaymentForUser,
  createRouterOrderForUser,
  createSupportTicketForUser,
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

function getAuthorizedUserId(request: FastifyRequest): string | null {
  return getClientSessionFromRequest(request)?.u ?? null;
}

await app.register(cors, {
  origin: [config.NEXT_PUBLIC_APP_URL],
  credentials: true
});

await app.register(sensible);

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
    public: ["/health", "/api/overview", "/api/site", "/api/routes", "/api/auth/email", "/api/auth/credentials"],
    planned: [
      "/api/me/overview",
      "/api/orders",
      "/api/support",
      "/api/routers/:routerId/template",
      "/api/routers/:routerId/renew",
      "/api/admin/overview",
      "/api/admin/routers"
    ]
  };
});

app.post("/api/auth/email", async (request, reply) => {
  const body = z
    .object({
      email: z.string().email(),
      name: z.string().trim().min(2).max(80).optional(),
      referralCode: z.string().trim().max(32).optional()
    })
    .parse(request.body);

  const result = await upsertClientFromEmail(body);
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
            referralCode: body.referralCode
          })
        : await loginClientFromCredentials({
            login: body.login,
            password: body.password
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
  const userId = getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  return buildClientOverview(userId);
});

app.post("/api/orders", async (request, reply) => {
  const userId = getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  return createRouterOrderForUser(userId);
});

app.post("/api/support", async (request, reply) => {
  const userId = getAuthorizedUserId(request);
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
  const userId = getAuthorizedUserId(request);
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
  const userId = getAuthorizedUserId(request);
  if (!userId) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  const params = z.object({ routerId: z.string().min(1) }).parse(request.params);

  try {
    return await createRenewalPaymentForUser({
      userId,
      routerId: params.routerId
    });
  } catch (error) {
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : "Не удалось создать продление."
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
