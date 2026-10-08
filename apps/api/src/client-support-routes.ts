import type { FastifyInstance } from "fastify";
import { getClientSessionFromRequest } from "./client-auth.js";
import { getClientSupportTicketForUser } from "./portal.js";

export async function registerClientSupportRoutes(app: FastifyInstance) {
  app.get<{ Params: { ticketId: string } }>("/api/me/tickets/:ticketId", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const session = await getClientSessionFromRequest(request);
    if (!session) return reply.code(401).send({ error: "Сессия истекла. Войдите снова." });
    const ticket = await getClientSupportTicketForUser({ userId: session.u, ticketId: request.params.ticketId });
    if (!ticket) return reply.code(404).send({ error: "Обращение не найдено." });
    return ticket;
  });
}
