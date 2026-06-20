// Race-safe + variant-name-safe resolution of Artist + Venue rows from
// an incoming (name, city, ticketmasterId?) payload. The Ticketmaster
// catalog returns the same real-world venue under multiple spellings
// (e.g., "Ocean Resort Casino" vs "Ocean Casino Resort"), which the
// (name, city) unique index treats as distinct. Using the stable
// Ticketmaster ID as the primary lookup key collapses those variants
// onto a single canonical row.
//
// Resolution priority:
//   1. Look up by Ticketmaster id (if provided + present in our DB).
//      Definitive match — collapses name variants.
//   2. Fall back to name(+city) upsert (race-safe via the unique index).
//   3. If we have a Ticketmaster id but didn't find a row by it in step
//      1, stamp the link so the NEXT call can resolve by step 1.
//
// Both functions are pure (deps injected) so they're unit-testable
// against a mocked Prisma client.

import type { PrismaClient } from "@prisma/client";

const TICKETMASTER_PROVIDER = "ticketmaster";

// ---------------------------------------------------------------------------
// resolveArtist
// ---------------------------------------------------------------------------

export type ResolveArtistDeps = {
  prisma: PrismaClient;
};

export type ResolveArtistInput = {
  name: string;
  ticketmasterId?: string | null;
};

export type ResolvedArtist = {
  id: string;
  name: string;
  ticketmasterId: string | null;
};

export async function resolveArtist(
  input: ResolveArtistInput,
  deps: ResolveArtistDeps,
): Promise<ResolvedArtist> {
  // 1. Definitive: look up by ticketmasterId if provided.
  if (input.ticketmasterId) {
    const byId = await deps.prisma.artist.findUnique({
      where: { ticketmasterId: input.ticketmasterId },
      select: { id: true, name: true, ticketmasterId: true },
    });
    if (byId) return byId;
  }

  // 2. Fall back to name upsert (race-safe via Artist_name_key).
  //    If we have a ticketmasterId AND the existing row by-name lacks
  //    one, stamp it so future calls can resolve via step 1.
  const stampedTicketmasterId = input.ticketmasterId ?? null;
  const upserted = await deps.prisma.artist.upsert({
    where: { name: input.name },
    update: stampedTicketmasterId
      ? { ticketmasterId: stampedTicketmasterId }
      : {},
    create: { name: input.name, ticketmasterId: stampedTicketmasterId },
    select: { id: true, name: true, ticketmasterId: true },
  });
  return upserted;
}

// ---------------------------------------------------------------------------
// resolveVenue
// ---------------------------------------------------------------------------

export type ResolveVenueDeps = {
  prisma: PrismaClient;
};

export type ResolveVenueInput = {
  name: string;
  city: string;
  ticketmasterId?: string | null;
};

export type ResolvedVenue = {
  id: string;
  name: string;
  city: string;
};

export async function resolveVenue(
  input: ResolveVenueInput,
  deps: ResolveVenueDeps,
): Promise<ResolvedVenue> {
  // 1. Definitive: look up via VenueExternalRef if a ticketmasterId is
  //    provided. This is what collapses "Ocean Resort Casino" and
  //    "Ocean Casino Resort" onto one canonical Venue.
  if (input.ticketmasterId) {
    const ref = await deps.prisma.venueExternalRef.findUnique({
      where: {
        provider_providerVenueId: {
          provider: TICKETMASTER_PROVIDER,
          providerVenueId: input.ticketmasterId,
        },
      },
      include: {
        venue: { select: { id: true, name: true, city: true } },
      },
    });
    if (ref?.venue) return ref.venue;
  }

  // 2. Fall back to (name, city) upsert (race-safe via
  //    Venue_name_city_key).
  const venue = await deps.prisma.venue.upsert({
    where: { name_city: { name: input.name, city: input.city } },
    update: {},
    create: { name: input.name, city: input.city },
    select: { id: true, name: true, city: true },
  });

  // 3. If we have a ticketmasterId, stamp the link so the next call
  //    with the same id resolves via step 1 regardless of which spelling
  //    Ticketmaster returns. Upsert keyed on (provider, providerVenueId)
  //    is race-safe via the existing unique index on that tuple.
  if (input.ticketmasterId) {
    await deps.prisma.venueExternalRef.upsert({
      where: {
        provider_providerVenueId: {
          provider: TICKETMASTER_PROVIDER,
          providerVenueId: input.ticketmasterId,
        },
      },
      update: { venueId: venue.id },
      create: {
        provider: TICKETMASTER_PROVIDER,
        providerVenueId: input.ticketmasterId,
        venueId: venue.id,
      },
    });
  }

  return venue;
}
