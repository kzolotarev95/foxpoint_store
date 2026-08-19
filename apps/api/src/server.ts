import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { z } from "zod";
import { readAdminSession } from "./admin-auth.js";
import { getAdminSettings, saveAdminSettings } from "./admin-settings.js";
import { config } from "./config.js";
import { buildOverview } from "./overview.js";
import { prisma } from "./prisma.js";

const app = Fastify({
  logger: true
});

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

app.get("/api/routes", async () => {
  return {
    public: ["/health", "/api/overview", "/api/routes"],
    planned: [
      "/auth",
      "/me",
      "/routers",
      "/subscriptions",
      "/payments",
      "/orders",
      "/support",
      "/referrals",
      "/balance",
      "/notifications",
      "/admin"
    ]
  };
});

app.get("/api/admin/settings", async (request, reply) => {
  if (!readAdminSession(request.headers.cookie)) {
    reply.code(401);
    return {
      error: "unauthorized"
    };
  }

  return {
    settings: await getAdminSettings()
  };
});

app.put("/api/admin/settings", async (request, reply) => {
  if (!readAdminSession(request.headers.cookie)) {
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
