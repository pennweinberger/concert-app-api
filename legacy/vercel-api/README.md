# Legacy Vercel serverless handlers

These files are the original Vercel serverless functions from before the
backend moved to Fastify. They are kept for reference only. Production
traffic is served by `src/server.ts`.

**Do not move this folder back to the repository root as `api/`.**
Vercel automatically deploys every file under a root `api/` directory as a
public serverless function, alongside the Fastify app. That happened until
2026-09-13: `/api/shows/confirm`, `/api/feed`, `/api/health`,
`/api/shows/search` and `/api/artists/search` were all live in production
with none of the Fastify auth, rate limiting or moderation filters.
`POST /api/shows/confirm` let anyone create Artist, Venue and Show rows.

To change an endpoint, edit the Fastify route in `src/server.ts` instead.
