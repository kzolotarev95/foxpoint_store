import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getClientSessionFromRequest } from "./client-auth.js";
import { clearClientNotificationFeed, getClientNotificationFeed, markClientNotificationsRead } from "./notifications.js";

export async function registerNotificationRoutes(app: FastifyInstance) {
  await app.register(async routes => {
    routes.addHook("onRequest", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });
    routes.get("/api/me/notifications", async (request, reply) => {
      const session = await getClientSessionFromRequest(request);
      if (!session) return reply.code(401).send({ error: "Сессия истекла. Войдите снова." });
      return getClientNotificationFeed(session.u);
    });
    for (const action of ["read", "clear"] as const) routes.post(`/api/me/notifications/${action}`, async (request, reply) => {
      const session = await getClientSessionFromRequest(request);
      if (!session) return reply.code(401).send({ error: "Сессия истекла. Войдите снова." });
      const payload = z.object({ before: z.string().datetime().optional(), notificationId: z.string().min(1).max(100).optional() }).safeParse(request.body ?? {});
      if (!payload.success) return reply.code(400).send({ error: "Обновите список уведомлений и повторите действие." });
      try {
        return action === "read" ? await markClientNotificationsRead({ userId: session.u, ...payload.data }) : await clearClientNotificationFeed({ userId: session.u, before: payload.data.before });
      } catch (error) { reply.code(400); return { error: error instanceof Error ? error.message : "Не удалось обновить уведомления." }; }
    });
  });
}
