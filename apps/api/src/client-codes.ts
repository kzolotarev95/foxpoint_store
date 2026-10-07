import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

// Codes 1–26 belong to the supplied client register, including its empty last row.
const RESERVED_CLIENT_NUMBER = 26;

// The audit actor is a service account, not a customer from the client register.
export const CLIENT_USER_WHERE: Prisma.UserWhereInput = {
  NOT: { identities: { some: { provider: "EMAIL", email: { startsWith: "admin+", endsWith: "@foxpoint.local" } } } }
};

export async function assignMissingCodes(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(746021)`;
  const users = await tx.user.findMany({
    where: CLIENT_USER_WHERE,
    select: { id: true, clientCode: true, nextRouterNumber: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  const allCodes = await tx.user.findMany({ select: { clientCode: true } });
  let next = Math.max(RESERVED_CLIENT_NUMBER, ...allCodes.map((user) =>
    Number(user.clientCode?.match(/^CLI-(\d+)$/)?.[1] ?? 0))) + 1;
  for (const user of users) {
    if (!user.clientCode) {
      user.clientCode = `CLI-${String(next++).padStart(4, "0")}`;
      await tx.user.update({ where: { id: user.id }, data: { clientCode: user.clientCode } });
    }
  }
  const routers = await tx.router.findMany({
    select: { id: true, ownerUserId: true, routerCode: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  const used = new Set(routers.map((router) => router.routerCode).filter(Boolean));
  const owners = new Map(users.map((user) => [user.id, user]));
  for (const router of routers) {
    if (router.routerCode) continue;
    const owner = owners.get(router.ownerUserId);
    const base = owner?.clientCode;
    if (!owner || !base) continue;
    let number = owner.nextRouterNumber;
    let code = number === 1 ? base : `${base}/${String(number).padStart(2, "0")}`;
    while (used.has(code)) { number++; code = `${base}/${String(number).padStart(2, "0")}`; }
    await tx.router.update({ where: { id: router.id }, data: { routerCode: code } });
    owner.nextRouterNumber = number + 1;
    await tx.user.update({ where: { id: owner.id }, data: { nextRouterNumber: owner.nextRouterNumber } });
    used.add(code);
  }
}

export async function ensureClientAndRouterCodes() {
  const missing = await prisma.user.findFirst({ where: { AND: [CLIENT_USER_WHERE, { clientCode: null }] }, select: { id: true } })
    ?? await prisma.router.findFirst({ where: { routerCode: null }, select: { id: true } });
  if (missing) await prisma.$transaction(assignMissingCodes, { timeout: 30000 });
}
