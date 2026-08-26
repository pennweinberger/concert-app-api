# Database security posture

## The Supabase Data API is intentionally disabled. Do not re-enable it.

Afterset is **backend-first**. The browser talks to Fastify; Fastify talks to
Postgres through Prisma. Nothing talks to Supabase's Data API (PostgREST),
and nothing should.

```
browser ──HTTPS──> Fastify (Vercel) ──Prisma──> Postgres (Supabase)
                                  ▲
                   PostgREST ─────┘  ✗ intentionally closed
```

Verified at the time of writing: no `@supabase/supabase-js` in either
project, no `SUPABASE_*` environment variables, no client-side table
access, no Realtime, no RPCs, no `supabase.co` reference anywhere in the
repo. Auth is `@fastify/jwt` + bcrypt, not Supabase Auth. Cron jobs and the
GitHub Action call our own `/internal/ingest/*` endpoints.

## If you are here because the Security Advisor is complaining

**Do not add RLS policies.** A policy is a rule about who may read rows
*through the Data API*. Adding one re-opens the surface this document exists
to keep closed, and "make the linter green" is not a reason to expose a
database to the internet.

The advisor should currently report **zero** findings. If it starts
complaining again, something has regranted access — investigate that rather
than papering over it.

## What is in place

Two independent layers, either of which alone would block access:

1. **No privileges.** `anon` and `authenticated` — the two roles PostgREST
   connects as — hold zero privileges on every table, sequence and function
   in `public`. Default privileges are also revoked, so a table created by a
   future Prisma migration is *not* exposed unless somebody deliberately
   grants it. This is the real control.
2. **RLS with no policies** on all 21 tables. RLS enabled with zero policies
   denies every row to every non-`BYPASSRLS` role. This is defence in depth
   against an accidental future `GRANT`.

`public` is also removed from **Exposed Schemas** in the Supabase dashboard.

## Why this does not break Prisma

Prisma connects as `postgres`, which has **`BYPASSRLS = true`** and its own
explicit table privileges. RLS policies do not apply to it at all.

**Re-check this before any future RLS work**, because the whole design rests
on it:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

## Files

| File | Purpose |
|---|---|
| `harden-data-api.sql` | What was applied. Documents the reasoning inline. |
| `rollback-data-api.sql` | Restores the previous (exposed) state. Only run deliberately. |
| `grants-snapshot-*.json` | Exact pre-change grants, so a rollback restores the real prior state rather than an approximation. Schema metadata only — no secrets, no row data. |

## How to verify the boundary holds

Do not go looking for the anon key. Test as the roles PostgREST actually
uses:

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT 1 FROM "User" LIMIT 1;   -- expect: ERROR 42501 insufficient_privilege
ROLLBACK;
```

## If you ever genuinely need the Data API

That is a real architectural decision, not a lint fix. It would mean:
granting only the specific tables required, writing restrictive policies for
each, and treating the anon key as published. Discuss it before doing it —
`User` holds password hashes and `VerificationToken` holds tokens that grant
account access.
