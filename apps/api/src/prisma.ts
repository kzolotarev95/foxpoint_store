import { PrismaClient } from "@prisma/client";

declare global {
  var __foxpointPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__foxpointPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__foxpointPrisma = prisma;
}

