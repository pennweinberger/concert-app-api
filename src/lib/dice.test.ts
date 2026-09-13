import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchVenuePageHtml, DICE_USER_AGENT } from "./dice.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * The crawler must say exactly who it is. It should never pose as a browser
 * or borrow another crawler's name, and the URL it advertises has to resolve
 * to something real: the previous one pointed at a /bot page that never
 * existed.
 */
describe("DICE crawler identification", () => {
  it("identifies as Afterset and links to the live product", () => {
    expect(DICE_USER_AGENT).toBe(
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
      expect(DICE_USER_AGENT).not.toMatch(disguise);
    }
  });

  it("no longer advertises the old pre-domain alias", () => {
    expect(DICE_USER_AGENT).not.toContain("afterset-pied");
  });

  it("sends that identity on the actual venue-page request", async () => {
    vi.stubEnv("DICE_INGEST_ENABLED", "true");
    const fetchMock = vi.fn(async () => new Response("<html></html>"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchVenuePageHtml("8p85");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://dice.fm/venue/8p85");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      DICE_USER_AGENT,
    );
  });
});
