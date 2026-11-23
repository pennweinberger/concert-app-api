import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ShowSearch from "./ShowSearch";

// The search box used to match artist NAMES but only ever return SHOWS,
// so an artist page was reachable only by opening a show first. These
// tests pin the new contract: artists appear above shows, they navigate
// straight to /artist/:id, show rows are untouched, and — the subtle one
// — a slow response for an older query can never overwrite a newer one.
//
// No `waitFor` anywhere: these run on fake timers so the debounce is
// deterministic, and waitFor would deadlock waiting on a clock only the
// test advances. `settle()` drains the timer and the promise chain, after
// which the DOM is already final.

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getToken: vi.fn(() => "tok" as string | null),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("../lib/auth", () => ({
  getToken: () => mocks.getToken(),
  authHeaders: () => ({ Authorization: "Bearer tok" }),
}));

const DEBOUNCE_MS = 250;

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** Show rows deliberately use a different artist name from artist rows,
 *  so a getByText can never be ambiguous about which row it found. */
const showsPayload = (
  rows: Array<{ id: string; artist: string; venue: string }>,
) => ({
  items: rows.map((r) => ({
    id: r.id,
    artist: { id: `a_${r.id}`, name: r.artist },
    venue: { id: `v_${r.id}`, name: r.venue, city: "Brooklyn" },
    localDate: "2026-11-22T00:00:00.000Z",
    reviewCount: 0,
    attendanceCount: 0,
  })),
});

const artistsPayload = (rows: Array<{ id: string; name: string }>) => ({
  items: rows,
});

/** Routes by URL so tests never depend on request ordering. */
function routeFetch(h: { shows?: unknown; tm?: unknown; artists?: unknown }) {
  return vi.fn((url: string) => {
    if (String(url).includes("/artists?")) {
      return Promise.resolve(json(h.artists ?? { items: [] }));
    }
    if (String(url).includes("/shows/search?")) {
      return Promise.resolve(json(h.tm ?? { items: [] }));
    }
    return Promise.resolve(json(h.shows ?? { items: [] }));
  });
}

function type(value: string) {
  fireEvent.change(screen.getByLabelText("Search artists and shows"), {
    target: { value },
  });
}

/** Advance the debounce, then drain the fetch → json() → setState chain. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(DEBOUNCE_MS);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/** Let an already-issued promise resolve and its handlers run. */
async function flush(fn?: () => void) {
  await act(async () => {
    fn?.();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.push.mockReset();
  mocks.getToken.mockReturnValue("tok");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ShowSearch — artist results", () => {
  it("renders an Artists section above the shows", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        artists: artistsPayload([{ id: "art1", name: "LCD Soundsystem" }]),
        shows: showsPayload([
          { id: "s1", artist: "Some Other Band", venue: "Knockdown Center" },
        ]),
      }),
    );
    render(<ShowSearch />);
    type("lcd");
    await settle();

    expect(screen.getByText("Artists")).toBeTruthy();
    expect(screen.getByText("Shows")).toBeTruthy();
    expect(screen.getByText("LCD Soundsystem")).toBeTruthy();
    expect(screen.getByText("Some Other Band")).toBeTruthy();
  });

  it("navigates straight to the artist page when an artist row is clicked", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        artists: artistsPayload([{ id: "art1", name: "LCD Soundsystem" }]),
      }),
    );
    render(<ShowSearch />);
    type("lcd");
    await settle();

    fireEvent.click(screen.getByText("LCD Soundsystem"));
    expect(mocks.push).toHaveBeenCalledWith("/artist/art1");
  });

  it("omits the section entirely — header included — when no artist matches", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        artists: artistsPayload([]),
        shows: showsPayload([
          { id: "s1", artist: "Some Other Band", venue: "Elsewhere" },
        ]),
      }),
    );
    render(<ShowSearch />);
    type("lcd");
    await settle();

    expect(screen.getByText("Some Other Band")).toBeTruthy();
    expect(screen.queryByText("Artists")).toBeNull();
    // Nothing to separate, so the Shows label stays hidden too and the
    // list looks exactly as it did before this feature.
    expect(screen.queryByText("Shows")).toBeNull();
  });

  it("shows at most three artists", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        artists: artistsPayload([
          { id: "a1", name: "Artist One" },
          { id: "a2", name: "Artist Two" },
          { id: "a3", name: "Artist Three" },
          { id: "a4", name: "Artist Four" },
        ]),
      }),
    );
    render(<ShowSearch />);
    type("artist");
    await settle();

    expect(screen.getByText("Artist One")).toBeTruthy();
    expect(screen.queryByText("Artist Four")).toBeNull();
  });

  it("asks the artists endpoint for the trimmed query", async () => {
    const fetchMock = routeFetch({});
    vi.stubGlobal("fetch", fetchMock);
    render(<ShowSearch />);
    type("  lcd  ");
    await settle();

    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/artists?"),
    );
    expect(call).toBeTruthy();
    expect(String(call![0])).toContain("q=lcd");
  });
});

describe("ShowSearch — existing show behaviour is unchanged", () => {
  it("still navigates to the show page for one of our own shows", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        shows: showsPayload([
          { id: "s1", artist: "Some Other Band", venue: "Knockdown Center" },
        ]),
      }),
    );
    render(<ShowSearch />);
    type("lcd");
    await settle();

    fireEvent.click(screen.getByText("Some Other Band"));
    expect(mocks.push).toHaveBeenCalledWith("/show/s1");
  });

  it("offers the write-a-review escape hatch when nothing matches at all", async () => {
    vi.stubGlobal("fetch", routeFetch({}));
    render(<ShowSearch />);
    type("zzzz");
    await settle();

    expect(screen.getByText(/Nothing matching/)).toBeTruthy();
    expect(screen.getByText("write a review")).toBeTruthy();
  });
});

describe("ShowSearch — stale responses", () => {
  it("a slow response for an older query cannot overwrite newer results", async () => {
    // Request 1 ("lcd") hangs. Request 2 ("beatles") answers at once.
    // Then request 1 finally lands. The newer results must survive —
    // debouncing cannot help here, because request 1 is already away.
    const pending: Array<() => void> = [];

    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      const isArtists = u.includes("/artists?");
      if (u.includes("q=lcd")) {
        return new Promise<Response>((resolve) => {
          pending.push(() =>
            resolve(
              json(
                isArtists
                  ? artistsPayload([{ id: "stale", name: "STALE ARTIST" }])
                  : showsPayload([
                      { id: "stale", artist: "STALE SHOW", venue: "Old" },
                    ]),
              ),
            ),
          );
        });
      }
      return Promise.resolve(
        json(
          isArtists
            ? artistsPayload([{ id: "fresh", name: "FRESH ARTIST" }])
            : showsPayload([
                { id: "fresh", artist: "FRESH SHOW", venue: "New" },
              ]),
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ShowSearch />);
    type("lcd");
    await settle();
    expect(pending.length).toBeGreaterThan(0); // the stale request really was issued

    type("beatles");
    await settle();
    expect(screen.getByText("FRESH ARTIST")).toBeTruthy();

    await flush(() => pending.forEach((r) => r()));

    expect(screen.getByText("FRESH ARTIST")).toBeTruthy();
    expect(screen.getByText("FRESH SHOW")).toBeTruthy();
    expect(screen.queryByText("STALE ARTIST")).toBeNull();
    expect(screen.queryByText("STALE SHOW")).toBeNull();
  });

  it("clearing the box below the minimum length discards an in-flight response", async () => {
    const pending: Array<() => void> = [];
    const fetchMock = vi.fn((url: string) => {
      const isArtists = String(url).includes("/artists?");
      return new Promise<Response>((resolve) => {
        pending.push(() =>
          resolve(
            json(
              isArtists
                ? artistsPayload([{ id: "late", name: "LATE ARTIST" }])
                : { items: [] },
            ),
          ),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ShowSearch />);
    type("lcd");
    await settle();
    type("l"); // back under MIN_QUERY_CHARS
    await flush(() => pending.forEach((r) => r()));

    expect(screen.queryByText("LATE ARTIST")).toBeNull();
  });
});
