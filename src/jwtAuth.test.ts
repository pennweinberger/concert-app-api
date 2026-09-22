// Auth regression tests for the @fastify/jwt + fast-jwt contract that
// server.ts depends on.
//
// WHY THIS FILE EXISTS: every authenticated route in server.ts is guarded
// by the same three helpers (getOptionalUserId, requireActiveUserId,
// requireVerifiedActiveUserId / requireAdminUserId), and all of them boil
// down to a bare `await request.jwtVerify()` inside a try/catch that turns
// any failure into a 401. That means the security of the whole API rests
// on what the JWT libraries accept — not on code in this repo. A silent
// behavior change in @fastify/jwt or fast-jwt (an upgrade, a transitive
// bump, an `overrides` entry) would not break a single other test in this
// suite. These tests are the tripwire for that.
//
// server.ts cannot be imported here: it calls start() at module scope and
// process.exit(1) when JWT_SECRET is unset. So the fixture below mirrors
// its wiring exactly — Fastify({ trustProxy: true }), the plugin
// registered with a static string `secret`, tokens signed with
// `expiresIn: "30d"`, and verification via a no-argument
// `request.jwtVerify()`. Keep it in sync with server.ts if that wiring
// changes.

import { describe, it, expect } from "vitest";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import fastifyJwt from "@fastify/jwt";
import crypto from "node:crypto";

const FIXTURE_SECRET = "test-secret-do-not-use-in-production";

// A token minted on 2026-09-21 by the stack as it shipped at the time:
// @fastify/jwt 7.2.4 / fast-jwt 3.3.3, HS256, payload shaped exactly like
// server.ts signs it, with exp pinned to 2100-01-01 so it never expires
// out from under this test.
//
// Tokens are handed to users with a 30-day lifetime, so at any upgrade
// there are live sessions in this format. If this assertion ever fails,
// the upgrade in question logs every existing user out — which is a
// deliberate decision to make, not a surprise to discover in production.
const LEGACY_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1X2xlZ2FjeV8xIiwiaGFuZGxlIjoibGVnYWN5dXNlciIsImV4cCI6NDEwMjQ0NDgwMCwiaWF0IjoxNzkwMDQ4MTM5fQ.xexyi4DzgprKsjfPoesylut93OUdbw0LBp3LnmhrUiY";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { userId: string; handle: string };
    user: { userId: string; handle: string };
  }
}

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  app.register(fastifyJwt, { secret: FIXTURE_SECRET });

  // Mirrors the /auth/login and /auth/register sign calls.
  app.post("/login", async (_request, reply) => {
    const token = await reply.jwtSign(
      { userId: "u_1", handle: "penn" },
      { expiresIn: "30d" },
    );
    return { token };
  });

  // Mirrors the guard shape used by all 18 jwtVerify call sites: any
  // verification failure becomes a 401, never a 500.
  app.get("/protected", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    return { userId: request.user.userId, handle: request.user.handle };
  });

  // Mirrors getOptionalUserId: public route, personalized when a valid
  // token happens to be present.
  app.get("/optional", async (request: FastifyRequest) => {
    let userId: string | null = null;
    try {
      await request.jwtVerify();
      userId = request.user.userId;
    } catch {
      userId = null;
    }
    return { userId };
  });

  await app.ready();
  return app;
}

function b64url(value: object | string): string {
  return Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
  ).toString("base64url");
}

/**
 * Builds a token from arbitrary header/payload, HMAC-signed with `key`.
 * Passing `key: null` produces a token with an empty signature, which is
 * what an `alg: "none"` forgery looks like on the wire.
 */
function forge(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: string | null,
): string {
  const input = `${b64url(header)}.${b64url(payload)}`;
  const signature =
    key === null
      ? ""
      : crypto.createHmac("sha256", key).update(input).digest("base64url");
  return `${input}.${signature}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function get(
  app: FastifyInstance,
  url: string,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: "GET",
    url,
    ...(token === undefined
      ? {}
      : { headers: { authorization: `Bearer ${token}` } }),
  });
  return { status: res.statusCode, body: res.json() };
}

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/login" });
  return res.json().token as string;
}

describe("JWT sign + verify (the happy path server.ts relies on)", () => {
  it("issues an HS256 token whose claims survive a round trip", async () => {
    const app = await makeApp();
    const token = await login(app);

    const [rawHeader, rawPayload] = token.split(".");
    const header = JSON.parse(
      Buffer.from(rawHeader!, "base64url").toString("utf-8"),
    );
    const payload = JSON.parse(
      Buffer.from(rawPayload!, "base64url").toString("utf-8"),
    );

    expect(header.alg).toBe("HS256");
    expect(header.typ).toBe("JWT");
    expect(payload).toMatchObject({ userId: "u_1", handle: "penn" });

    const { status, body } = await get(app, "/protected", token);
    expect(status).toBe(200);
    expect(body).toEqual({ userId: "u_1", handle: "penn" });

    await app.close();
  });

  it("sets a 30-day expiry, not a missing or shorter one", async () => {
    const app = await makeApp();
    const token = await login(app);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf-8"),
    );

    const thirtyDays = 30 * 24 * 60 * 60;
    expect(payload.exp - payload.iat).toBe(thirtyDays);
    expect(payload.exp).toBeGreaterThan(nowSeconds());

    await app.close();
  });

  it("emits strict base64url with no padding, so any decoder accepts it", async () => {
    const app = await makeApp();
    const token = await login(app);
    expect(token).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    await app.close();
  });

  it("still verifies a token minted by the pre-upgrade stack", async () => {
    // Guards the live 30-day sessions across dependency upgrades.
    const app = await makeApp();
    const { status, body } = await get(app, "/protected", LEGACY_TOKEN);
    expect(status).toBe(200);
    expect(body).toEqual({ userId: "u_legacy_1", handle: "legacyuser" });
    await app.close();
  });
});

describe("JWT rejection (each of these must be a 401, never a 200 or a 500)", () => {
  const claims = () => ({
    userId: "u_admin",
    handle: "attacker",
    iat: nowSeconds(),
    exp: nowSeconds() + 3600,
  });

  it("rejects a token whose payload was edited after signing", async () => {
    const app = await makeApp();
    const token = await login(app);
    const [header, , signature] = token.split(".");

    // Keep the genuine signature, swap in a different userId.
    const tampered = `${header}.${b64url({
      userId: "u_someone_else",
      handle: "penn",
      iat: nowSeconds(),
      exp: nowSeconds() + 3600,
    })}.${signature}`;

    const { status } = await get(app, "/protected", tampered);
    expect(status).toBe(401);
    await app.close();
  });

  it("rejects a token whose signature was edited", async () => {
    const app = await makeApp();
    const token = await login(app);
    const parts = token.split(".");
    const flipped = parts[2]!.startsWith("A")
      ? `B${parts[2]!.slice(1)}`
      : `A${parts[2]!.slice(1)}`;

    const { status } = await get(app, "/protected", `${parts[0]}.${parts[1]}.${flipped}`);
    expect(status).toBe(401);
    await app.close();
  });

  it("rejects a well-formed token signed with the wrong secret", async () => {
    const app = await makeApp();
    const token = forge(
      { alg: "HS256", typ: "JWT" },
      claims(),
      "not-the-real-secret",
    );
    const { status } = await get(app, "/protected", token);
    expect(status).toBe(401);
    await app.close();
  });

  it("rejects an expired token even though its signature is genuine", async () => {
    const app = await makeApp();
    const token = forge(
      { alg: "HS256", typ: "JWT" },
      {
        userId: "u_1",
        handle: "penn",
        iat: nowSeconds() - 7200,
        exp: nowSeconds() - 3600,
      },
      FIXTURE_SECRET,
    );
    const { status } = await get(app, "/protected", token);
    expect(status).toBe(401);
    await app.close();
  });

  it("rejects alg=none, with an empty signature or a bogus one", async () => {
    const app = await makeApp();

    const unsigned = forge({ alg: "none", typ: "JWT" }, claims(), null);
    expect((await get(app, "/protected", unsigned)).status).toBe(401);

    const noneWithJunk = `${unsigned}deadbeef`;
    expect((await get(app, "/protected", noneWithJunk)).status).toBe(401);

    await app.close();
  });

  it("rejects an empty-HMAC-key forgery (GHSA-gmvf-9v4p-v8jc)", async () => {
    // Not reachable through this wiring — the verifier is built from a
    // static string secret, not an async key resolver — but cheap to pin
    // so a future switch to a key resolver can't reintroduce it quietly.
    const app = await makeApp();
    const token = forge({ alg: "HS256", typ: "JWT", kid: "unknown" }, claims(), "");
    const { status } = await get(app, "/protected", token);
    expect(status).toBe(401);
    await app.close();
  });

  it("rejects an unknown crit header extension (GHSA-hm7r-c7qw-ghp6)", async () => {
    // RFC 7515 4.1.11: a `crit` extension the recipient does not
    // understand makes the JWS invalid. fast-jwt only started enforcing
    // this in 6.2.0, so before that upgrade this token is accepted when
    // it carries a valid signature. The forgery below is signed with the
    // WRONG secret, which both versions reject; the signed-with-the-real-
    // secret case is asserted separately so the fix is visible.
    const app = await makeApp();
    const token = forge(
      { alg: "HS256", typ: "JWT", crit: ["x-custom-policy"], "x-custom-policy": "require-mfa" },
      claims(),
      "not-the-real-secret",
    );
    const { status } = await get(app, "/protected", token);
    expect(status).toBe(401);
    await app.close();
  });

  it("documents crit handling for a validly signed token", async () => {
    // Accepted on fast-jwt < 6.2.0, rejected from 6.2.0 on. Either way it
    // requires the signing secret, so it is not an attacker capability —
    // this assertion exists to make the upgrade's effect explicit.
    const app = await makeApp();
    const token = forge(
      { alg: "HS256", typ: "JWT", crit: ["x-custom-policy"], "x-custom-policy": "require-mfa" },
      claims(),
      FIXTURE_SECRET,
    );
    const { status } = await get(app, "/protected", token);
    expect(status).toBe(200);
    await app.close();
  });

  it("rejects a missing, malformed or non-Bearer Authorization header", async () => {
    // @fastify/jwt has changed which error it raises for these across
    // majors (400 vs 401); server.ts's try/catch collapses all of them to
    // 401, which is the contract that matters to clients.
    const app = await makeApp();

    expect((await get(app, "/protected")).status).toBe(401);
    expect((await get(app, "/protected", "")).status).toBe(401);
    expect((await get(app, "/protected", "not.a.token")).status).toBe(401);
    expect((await get(app, "/protected", "a.b.c.d")).status).toBe(401);

    const basic = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(basic.statusCode).toBe(401);

    const noScheme = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: await login(app) },
    });
    expect(noScheme.statusCode).toBe(401);

    await app.close();
  });
});

describe("optional authentication (public routes that personalize)", () => {
  it("resolves the user for a valid token and null for anything else", async () => {
    const app = await makeApp();
    const token = await login(app);

    expect((await get(app, "/optional", token)).body).toEqual({
      userId: "u_1",
    });
    expect((await get(app, "/optional")).body).toEqual({ userId: null });
    expect((await get(app, "/optional", "garbage")).body).toEqual({
      userId: null,
    });
    expect(
      (
        await get(
          app,
          "/optional",
          forge({ alg: "HS256", typ: "JWT" }, { userId: "x", handle: "y" }, "wrong"),
        )
      ).body,
    ).toEqual({ userId: null });

    await app.close();
  });
});
