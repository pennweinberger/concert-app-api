import { describe, it, expect, vi, afterEach } from "vitest";
import { INGESTION_USER_AGENT } from "./userAgent.js";
import { fetchVenuePageHtml } from "./dice.js";
import { fetchBoweryFeed } from "./bowery.js";
import { searchSetlistsByArtistMbid } from "./setlistfm.js";
import { fetchEventWindow } from "./ticketmaster.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type FetchMock = { mock: { calls: unknown[][] } };

function sentUserAgent(fetchMock: FetchMock): string | undefined {
  expect(fetchMock.mock.calls).toHaveLength(1);
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return (init.headers as Record<string, string>)["User-Agent"];
}

/**
 * The crawler must say exactly who it is. It should never pose as a browser
 * or borrow another crawler's name, and the URL it advertises has to resolve
 * to something real: an earlier one pointed at a /bot page that never existed.
 */
describe("ingestion identity", () => {
  it("identifies as Afterset and links to the live product", () => {
    expect(INGESTION_USER_AGENT).toBe(
      "Afterset-IngestionBot/1.0 (+https://afterset.fm)",
    );
  });

  it("does not look like a browser or another crawler", () => {
    for (const disguise of [
      /mozilla/i,
      /chrome/i,
      /safari/i,
      /applewebkit/i,
      /googlebot/i,
      /bingbot/i,
    ]) {
      expect(INGESTION_USER_AGENT).not.toMatch(disguise);
    }
  });

  it("no longer advertises the old pre-domain alias", () => {
    expect(INGESTION_USER_AGENT).not.toContain("afterset-pied");
  });
});

/**
 * Exercised through each client's real fetch path. A test over the constant
 * alone would not have caught the bug this replaces: DICE's own copy was
 * corrected while Bowery and setlist.fm kept sending a dead URL.
 */
describe("every ingestion client sends that identity", () => {
  it("DICE", async () => {
    vi.stubEnv("DICE_INGEST_ENABLED", "true");
    const fetchMock = vi.fn(async () => new Response("<html></html>"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchVenuePageHtml("8p85");

    expect(sentUserAgent(fetchMock)).toBe(INGESTION_USER_AGENT);
  });

  it("Bowery", async () => {
    vi.stubEnv("BOWERY_INGEST_ENABLED", "true");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchBoweryFeed();

    expect(sentUserAgent(fetchMock)).toBe(INGESTION_USER_AGENT);
  });

  it("setlist.fm", async () => {
    vi.stubEnv("SETLISTFM_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await searchSetlistsByArtistMbid("b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d");

    expect(sentUserAgent(fetchMock)).toBe(INGESTION_USER_AGENT);
  });

  it("Ticketmaster", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ page: { totalElements: 0 } })),
    );

    await fetchEventWindow(
      {
        dmaId: "345",
        startDateTime: "2026-01-01T00:00:00Z",
        endDateTime: "2026-01-08T00:00:00Z",
      },
      {
        apiKey: "test-key",
        enabled: true,
        fetchImpl: fetchMock as unknown as typeof fetch,
        sleep: async () => {},
      },
    );

    expect(sentUserAgent(fetchMock)).toBe(INGESTION_USER_AGENT);
  });
});
