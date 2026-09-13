import { PrismaClient } from "@prisma/client";

// Vercel serverless invocations reuse the same Node process when warm,
// so we cache the PrismaClient on globalThis to avoid exhausting the
// Postgres connection pool across invocations and HMR reloads.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
