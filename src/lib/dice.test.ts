import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchVenuePageHtml } from "./dice.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// The crawler identity this client sends is asserted in userAgent.test.ts,
// alongside every other ingestion client.
describe("DICE venue page fetch", () => {
  it("requests the short-id URL", async () => {
    vi.stubEnv("DICE_INGEST_ENABLED", "true");
    const fetchMock = vi.fn(async () => new Response("<html></html>"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchVenuePageHtml("8p85");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://dice.fm/venue/8p85");
  });
});
