// Merge two Venue rows that describe the same physical room.
//
// These exist because `Venue @@unique([name, city])` makes city part of a
// venue's identity, and providers disagree about city: Knockdown Center
// arrived as both "Maspeth" and "Queens", Pacha New York as both
// "Brooklyn" and "New York". The constraint meant to prevent duplicates
// created them instead.
//
// Merging matters more now that markets exist: a split venue can end up
// on both sides of a market boundary, so the same room would be
// simultaneously in and out of NYC.
//
// Nothing is deleted except the now-empty duplicate Venue row itself.
// Shows, reviews, attendances and provider refs all move to the survivor.

import type { PrismaClient } from "@prisma/client";

export type MergeResult = {
  survivorId: string;
  duplicateId: string;
  showsMoved: number;
  /** Shows that collided with an identical show on the survivor. */
  showsCollapsed: number;
  reviewsMoved: number;
  attendancesMoved: number;
  showRefsMoved: number;
  venueRefsMoved: number;
};

/**
 * @param survivorId the Venue that remains
 * @param duplicateId the Venue that is absorbed and then deleted
 */
export async function mergeVenues(
  survivorId: string,
  duplicateId: string,
  deps: { prisma: PrismaClient },
): Promise<MergeResult> {
  const { prisma } = deps;
  if (survivorId === duplicateId) {
    throw new Error("mergeVenues: survivor and duplicate are the same venue");
  }

  const result: MergeResult = {
    survivorId,
    duplicateId,
    showsMoved: 0,
    showsCollapsed: 0,
    reviewsMoved: 0,
    attendancesMoved: 0,
    showRefsMoved: 0,
    venueRefsMoved: 0,
  };

  const dupShows = await prisma.show.findMany({
    where: { venueId: duplicateId },
    select: { id: true, artistId: true, localDate: true },
  });

  for (const show of dupShows) {
    // Does the survivor already hold the same artist on the same night?
    // If so the two Show rows are the same real event and must be
    // collapsed, because (artistId, venueId, localDate) is unique.
    const twin = await prisma.show.findUnique({
      where: {
        artistId_venueId_localDate: {
          artistId: show.artistId,
          venueId: survivorId,
          localDate: show.localDate,
        },
      },
      select: { id: true },
    });

    if (!twin) {
      await prisma.show.update({
        where: { id: show.id },
        data: { venueId: survivorId },
      });
      result.showsMoved++;
      continue;
    }

    // Collapse: move everything hanging off the duplicate show, then
    // drop the now-empty duplicate show.
    const [reviews, attendances, refs] = [
      await prisma.review.updateMany({
        where: { showId: show.id },
        data: { showId: twin.id },
      }),
      await prisma.attendance.updateMany({
        where: { showId: show.id },
        data: { showId: twin.id },
      }),
      await prisma.showExternalRef.updateMany({
        where: { showId: show.id },
        data: { showId: twin.id },
      }),
    ];
    result.reviewsMoved += reviews.count;
    result.attendancesMoved += attendances.count;
    result.showRefsMoved += refs.count;

    await prisma.setlistCache.deleteMany({ where: { showId: show.id } });
    await prisma.show.delete({ where: { id: show.id } });
    result.showsCollapsed++;
  }

  // Provider links follow the survivor so future ingestion resolves there.
  const venueRefs = await prisma.venueExternalRef.updateMany({
    where: { venueId: duplicateId },
    data: { venueId: survivorId },
  });
  result.venueRefsMoved = venueRefs.count;

  await prisma.providerMatchReview.updateMany({
    where: { resolvedVenueId: duplicateId },
    data: { resolvedVenueId: survivorId },
  });
  await prisma.venueMarket.deleteMany({ where: { venueId: duplicateId } });

  await prisma.venue.delete({ where: { id: duplicateId } });
  return result;
}
