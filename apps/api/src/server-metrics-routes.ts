import type { FastifyInstance } from "fastify";
import { readAdminSession, readAdminSessionToken } from "./admin-auth.js";
import { collectServerMetrics } from "./server-metrics.js";

export async function registerServerMetricsRoutes(app: FastifyInstance, collect = collectServerMetrics) {
  app.get("/api/admin/server-metrics", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const header = request.headers["x-admin-session"];
    const token = Array.isArray(header) ? header[0] : header;
    if (!readAdminSession(request.headers.cookie) && !readAdminSessionToken(token)) return reply.code(401).send({ error: "Войдите в админ-панель." });
    return collect();
  });
}
