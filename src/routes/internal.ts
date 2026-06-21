// Internal routes — not for end users. Protected by CRON_SECRET bearer
// auth. Currently hosts the setlist.fm ingestion trigger; future
// internal jobs (admin queue actions, manual re-ingest, etc.) can plug
// in here.

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { runIngestion } from "../lib/setlistfmIngest.js";
import { searchSetlistsByArtistMbid } from "../lib/setlistfm.js";
import { cleanupAccountDeletions } from "../lib/accountLifecycle.js";
import { runDiceIngestion } from "../lib/diceIngest.js";
import { fetchVenuePageHtml } from "../lib/dice.js";

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

  // DICE NYC ingestion. Inert unless BOTH CRON_SECRET and
  // DICE_INGEST_ENABLED are set. The DICE client itself reads
  // DICE_INGEST_ENABLED on every fetch (returns DiceDisabledError when
  // missing); the route-level check below short-circuits cheaply
  // before we even authenticate the bearer.
  app.post(
    "/internal/ingest/dice",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cronSecret = process.env.CRON_SECRET;
      const diceEnabled = process.env.DICE_INGEST_ENABLED === "true";
      if (!cronSecret || !diceEnabled) {
        return reply
          .status(503)
          .send({ error: "DICE ingestion not configured" });
      }
      const auth = request.headers["authorization"];
      if (!auth || auth !== `Bearer ${cronSecret}`) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      // Optional operator-control query params:
      //   ?limit=N                  override per-run venue cap
      //   ?minHoursBetweenFetches=N override recency skip (0 = force)
      const q = request.query as {
        limit?: string;
        minHoursBetweenFetches?: string;
      };
      const parseNonNegInt = (raw: string | undefined): number | undefined => {
        if (raw === undefined) return undefined;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
      };
      const limit = parseNonNegInt(q.limit);
      const minHoursBetweenFetches = parseNonNegInt(q.minHoursBetweenFetches);

      try {
        const summary = await runDiceIngestion({
          prisma,
          fetchVenuePageHtml,
          now: () => new Date(),
          ...(limit !== undefined ? { limit } : {}),
          ...(minHoursBetweenFetches !== undefined
            ? { minHoursBetweenFetches }
            : {}),
        });
        return reply.status(200).send(summary);
      } catch (err: any) {
        app.log.error(err);
        return reply.status(500).send({
          error: "DICE ingestion failed",
          details: err?.message || String(err),
        });
      }
    },
  );
}
