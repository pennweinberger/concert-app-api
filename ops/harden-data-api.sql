-- Afterset: close the Supabase Data API (PostgREST) surface on `public`.
--
-- WHY: Supabase's Security Advisor flagged RLS disabled on every table.
-- Investigation showed the real issue was broader: all 21 tables granted
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE to BOTH `anon` and `authenticated`,
-- with PostgREST live and serving. Anyone holding the project's anon key —
-- a value designed to be embedded in browsers — had full read/write on
-- User (emails, bcrypt hashes) and VerificationToken (account-access
-- tokens), plus TRUNCATE on everything including _prisma_migrations.
--
-- Afterset does not use the Data API anywhere: no @supabase/supabase-js in
-- either project, no SUPABASE_* env vars, no client-side table access,
-- Realtime or RPCs. Auth is @fastify/jwt + bcrypt, not Supabase Auth.
-- The frontend talks only to Fastify; Fastify talks to Postgres via Prisma.
--
-- SAFE FOR PRISMA: Prisma connects as `postgres`, which has BYPASSRLS and
-- explicit privileges of its own. Nothing below touches that role.
--
-- Revoking grants is preferred over writing RLS policies because it makes
-- the DEFAULT state safe: a future table is unexposed unless someone
-- deliberately grants it, rather than exposed unless someone remembers to
-- enable RLS.

-- 1. Existing objects: remove every privilege from the PostgREST roles.
REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 2. Schema usage. NOTE: PUBLIC also holds USAGE on `public` (=U in the
--    schema ACL), which anon/authenticated inherit, so this specific
--    revoke is belt-and-braces rather than the control. We deliberately do
--    NOT revoke from PUBLIC: that affects every role including internal
--    Supabase ones, and it buys nothing once table privileges are gone —
--    schema USAGE alone grants no access to any row.
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;

-- 3. Future objects created by `postgres` (the role Prisma migrates as),
--    so new tables are not auto-exposed.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 4. Defence in depth on the two crown jewels. With RLS on and NO policies,
--    every non-BYPASSRLS role sees zero rows even if a grant is ever
--    restored by accident. Prisma (postgres, BYPASSRLS) is unaffected.
ALTER TABLE "User"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationToken" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- PHASE 2 (applied 2026-08-25): RLS on the remaining tables.
--
-- Defence in depth only — the grants above are the actual control. RLS with
-- ZERO policies denies every row to every non-BYPASSRLS role, so an
-- accidental future GRANT cannot silently re-expose a table.
--
-- DO NOT ADD POLICIES. A policy is a rule about who may read rows THROUGH
-- THE DATA API, which Afterset does not use. See ops/README.md.
-- ---------------------------------------------------------------------------
ALTER TABLE "Artist"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ArtistExternalRef"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Follow"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IngestRun"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Market"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderMatchReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Report"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Review"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReviewComment"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReviewLike"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SetlistCache"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Show"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShowExternalRef"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Venue"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VenueExternalRef"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VenueMarket"         ENABLE ROW LEVEL SECURITY;
-- Prisma's own migration bookkeeping. Verified afterwards that
-- `prisma migrate status` still reads it (the engine connects as postgres,
-- which has BYPASSRLS).
ALTER TABLE "_prisma_migrations"  ENABLE ROW LEVEL SECURITY;
