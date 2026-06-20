// Internal routes — not for end users. Protected by CRON_SECRET bearer
// auth. Currently hosts the setlist.fm ingestion trigger; future
// internal jobs (admin queue actions, manual re-ingest, etc.) can plug
// in here.

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { runIngestion } from "../lib/setlistfmIngest.js";
import { searchSetlistsByArtistMbid } from "../lib/setlistfm.js";
import { cleanupAccountDeletions } from "../lib/accountLifecycle.js";

export function registerInternalRoutes(
  app: FastifyInstance,
  prisma: PrismaClient
) {
  app.post(
    "/internal/ingest/setlistfm",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cronSecret = process.env.CRON_SECRET;
      const setlistfmKey = process.env.SETLISTFM_API_KEY;

      // Both env vars required. Without either, the endpoint stays
      // fully inert: no DB writes, no external HTTP, no Sentry alerts.
      if (!cronSecret || !setlistfmKey) {
        return reply
          .status(503)
          .send({ error: "Ingestion not configured" });
      }

      const auth = request.headers["authorization"];
      if (!auth || auth !== `Bearer ${cronSecret}`) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const summary = await runIngestion({
          prisma,
          searchSetlistsByArtistMbid,
          now: () => new Date(),
        });
        return reply.status(200).send(summary);
      } catch (err: any) {
        app.log.error(err);
        return reply.status(500).send({
          error: "Ingestion failed",
          details: err?.message || String(err),
        });
      }
    }
  );

  // Account-deletion cleanup. Anonymizes users whose deletedAt is older
  // than the 30-day grace period — strips PII, replaces handle with
  // _deleted_<id-suffix>, deletes Follow rows representing the active
  // identity. Reviews / likes / attendances are intentionally preserved
  // as archive records.
  app.post(
    "/internal/cleanup/account-deletions",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cronSecret = process.env.CRON_SECRET;
      if (!cronSecret) {
        return reply
          .status(503)
          .send({ error: "Cleanup not configured" });
      }
      const auth = request.headers["authorization"];
      if (!auth || auth !== `Bearer ${cronSecret}`) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const summary = await cleanupAccountDeletions({
          prisma,
          now: () => new Date(),
        });
        return reply.status(200).send(summary);
      } catch (err: any) {
        app.log.error(err);
        return reply.status(500).send({
          error: "Cleanup failed",
          details: err?.message || String(err),
        });
      }
    },
  );
}
