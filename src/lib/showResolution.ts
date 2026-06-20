// Race-safe + variant-name-safe resolution of Artist + Venue rows from
// an incoming payload that may carry one or more stable provider IDs.
// The provider id is the dedup signal that collapses variant spellings
// onto a canonical row (e.g., "Ocean Resort Casino" vs "Ocean Casino
// Resort" — Ticketmaster's catalog has the same real-world venue under
// both, but the same TM venue id).
//
// Resolution priority (artist):
//   1. findUnique by Ticketmaster id (if provided + present).
//   2. findUnique by DICE id (if provided + present).
//   3. upsert by name (race-safe via Artist_name_key), stamping any ids
//      we have so future calls can resolve via step 1 or 2.
//
// Resolution priority (venue):
//   1. VenueExternalRef lookup by (provider="ticketmaster", id).
//   2. VenueExternalRef lookup by (provider="dice", id).
//   3. upsert by (name, city) (race-safe via Venue_name_city_key), then
//      upsert a VenueExternalRef for each provided id.
//
// Both functions are pure (deps injected) so they're unit-testable
// against a mocked Prisma client.

import type { PrismaClient } from "@prisma/client";

const TICKETMASTER_PROVIDER = "ticketmaster";
const DICE_PROVIDER = "dice";

// ---------------------------------------------------------------------------
// resolveArtist
// ---------------------------------------------------------------------------

export type ResolveArtistDeps = {
  prisma: PrismaClient;
};

export type ResolveArtistInput = {
  name: string;
  ticketmasterId?: string | null;
  diceId?: string | null;
};

export type ResolvedArtist = {
  id: string;
  name: string;
  ticketmasterId: string | null;
  diceId: string | null;
};

export async function resolveArtist(
  input: ResolveArtistInput,
  deps: ResolveArtistDeps,
): Promise<ResolvedArtist> {
  // 1. Try Ticketmaster id if provided.
  if (input.ticketmasterId) {
    const byTm = await deps.prisma.artist.findUnique({
      where: { ticketmasterId: input.ticketmasterId },
      select: { id: true, name: true, ticketmasterId: true, diceId: true },
    });
    if (byTm) return byTm;
  }

  // 2. Try DICE id if provided.
  if (input.diceId) {
    const byDice = await deps.prisma.artist.findUnique({
      where: { diceId: input.diceId },
      select: { id: true, name: true, ticketmasterId: true, diceId: true },
    });
    if (byDice) return byDice;
  }

  // 3. Fall back to name upsert. Stamp whichever ids we have so future
  //    calls can resolve via the definitive id path.
  const updateData: { ticketmasterId?: string; diceId?: string } = {};
  if (input.ticketmasterId) updateData.ticketmasterId = input.ticketmasterId;
  if (input.diceId) updateData.diceId = input.diceId;

  const upserted = await deps.prisma.artist.upsert({
    where: { name: input.name },
    update: updateData,
    create: {
      name: input.name,
      ticketmasterId: input.ticketmasterId ?? null,
      diceId: input.diceId ?? null,
    },
    select: { id: true, name: true, ticketmasterId: true, diceId: true },
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
  diceId?: string | null;
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
  // 1. Try VenueExternalRef by Ticketmaster id if provided.
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

  // 2. Try VenueExternalRef by DICE id if provided. This is what
  //    collapses the 3 Elsewhere DICE records (Main / Hall / Rooftop)
  //    onto one canonical Elsewhere Venue once any one of them has
  //    been seeded — and what catches multi-room siblings going
  //    forward.
  if (input.diceId) {
    const ref = await deps.prisma.venueExternalRef.findUnique({
      where: {
        provider_providerVenueId: {
          provider: DICE_PROVIDER,
          providerVenueId: input.diceId,
        },
      },
      include: {
        venue: { select: { id: true, name: true, city: true } },
      },
    });
    if (ref?.venue) return ref.venue;
  }

  // 3. Fall back to (name, city) upsert (race-safe via
  //    Venue_name_city_key).
  const venue = await deps.prisma.venue.upsert({
    where: { name_city: { name: input.name, city: input.city } },
    update: {},
    create: { name: input.name, city: input.city },
    select: { id: true, name: true, city: true },
  });

  // 4. Stamp any provider links we have. These upserts are race-safe
  //    via the (provider, providerVenueId) unique index.
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
  if (input.diceId) {
    await deps.prisma.venueExternalRef.upsert({
      where: {
        provider_providerVenueId: {
          provider: DICE_PROVIDER,
          providerVenueId: input.diceId,
        },
      },
      update: { venueId: venue.id },
      create: {
        provider: DICE_PROVIDER,
        providerVenueId: input.diceId,
        venueId: venue.id,
      },
    });
  }

  return venue;
}
