// Internal routes — not for end users. Protected by CRON_SECRET bearer
// auth. Currently hosts the setlist.fm ingestion trigger; future
// internal jobs (admin queue actions, manual re-ingest, etc.) can plug
// in here.

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import * as Sentry from "@sentry/node";
import { runIngestion } from "../lib/setlistfmIngest.js";
import { searchSetlistsByArtistMbid } from "../lib/setlistfm.js";
import { cleanupAccountDeletions } from "../lib/accountLifecycle.js";
import { runDiceIngestion } from "../lib/diceIngest.js";
import { fetchVenuePageHtml } from "../lib/dice.js";
import { runBoweryIngestion } from "../lib/boweryIngest.js";
import { fetchBoweryFeed } from "../lib/bowery.js";

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
  //
  // Both POST and GET hit the same handler. POST is for manual triggers
  // (curl, ops scripts); GET is for Vercel Cron, which only fires GET
  // requests. The CRON_SECRET bearer gate is what keeps GET safe to use
  // on a side-effectful endpoint — without the secret, both methods
  // return 401.
  const handleDiceIngest = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
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
      // Caught errors don't reach the global Fastify error handler that
      // forwards to Sentry — so we capture explicitly here. Without this,
      // scheduled cron failures would be invisible in Sentry.
      app.log.error(err);
      Sentry.captureException(err);
      return reply.status(500).send({
        error: "DICE ingestion failed",
        details: err?.message || String(err),
      });
    }
  };

  app.post("/internal/ingest/dice", handleDiceIngest);
  app.get("/internal/ingest/dice", handleDiceIngest);

  // Bowery / AEG NYC ingestion. Inert unless BOTH CRON_SECRET and
  // BOWERY_INGEST_ENABLED are set. Single shared handler for POST
  // (manual ops trigger) and GET (Vercel Cron, which only fires GET).
  // The CRON_SECRET bearer gate keeps the side-effectful GET safe.
  //
  // Operator-control: ?dryRun=true parses + filters the feed and
  // returns the summary without writing any rows.
  const handleBoweryIngest = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const cronSecret = process.env.CRON_SECRET;
    const boweryEnabled = process.env.BOWERY_INGEST_ENABLED === "true";
    if (!cronSecret || !boweryEnabled) {
      return reply
        .status(503)
        .send({ error: "Bowery ingestion not configured" });
    }
    const auth = request.headers["authorization"];
    if (!auth || auth !== `Bearer ${cronSecret}`) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const q = request.query as { dryRun?: string };
    const dryRun = q.dryRun === "true" || q.dryRun === "1";

    try {
      const summary = await runBoweryIngestion({
        prisma,
        fetchBoweryFeed,
        now: () => new Date(),
        dryRun,
      });
      return reply.status(200).send(summary);
    } catch (err: any) {
      app.log.error(err);
      Sentry.captureException(err);
      return reply.status(500).send({
        error: "Bowery ingestion failed",
        details: err?.message || String(err),
      });
    }
  };

  app.post("/internal/ingest/bowery", handleBoweryIngest);
  app.get("/internal/ingest/bowery", handleBoweryIngest);
}
