// Reconciling DICE's re-keyed event ids.
//
// In August 2026 DICE replaced its 6-character event ids (which appeared
// in the URL followed by a slug) with 24-character ids that stand alone.
// The events themselves did not change: the ids embedded in them are
// MongoDB ObjectIds whose creation timestamps predate the switch, so DICE
// re-keyed listings it already had.
//
// Our 661 ShowExternalRef rows all carry the old ids. Without
// reconciliation, a re-keyed event looks brand new: the ref lookup misses,
// the event is matched again from scratch, and we end up with a second ref
// on the same Show, a duplicate review row — and, when DICE has also
// edited the title, a DUPLICATE Show under a newly invented artist,
// because the artist is guessed from that title.
//
// THE KEY DELIBERATELY EXCLUDES TITLE AND ARTIST. It is:
//
//     canonical venue + local date + exact start instant + room
//
// all of which we already store in the minimal dice-minimal-v1 payload.
// Title is exactly the field that changes when a promoter edits a
// listing, so matching on it would fail precisely when reconciliation
// matters most.
//
// STRICT, BOTH WAYS. A re-key happens only when exactly one legacy row
// matches the key and no other event in the same page shares it. Anything
// ambiguous, missing or already linked is left alone and goes through the
// normal matching and review path, counted so it is visible. A wrong
// re-key silently attaches an event to the wrong show; a missed one just
// creates a row a human can reconcile later.

import type { PrismaClient, Prisma } from "@prisma/client";
import { toDiceRawPayload, type DiceMusicEvent } from "./diceParse.js";

export const PROVIDER = "dice";

/** DICE's pre-August-2026 ids: six lowercase alphanumerics. */
export function isLegacyDiceEventId(id: string): boolean {
  return /^[a-z0-9]{6}$/.test(id);
}

/** DICE's current ids: 24 hex characters (a MongoDB ObjectId). */
export function isCurrentDiceEventId(id: string): boolean {
  return /^[0-9a-f]{24}$/.test(id);
}

/**
 * Identity of an event for reconciliation, within one canonical venue.
 * Used to detect two events on the SAME page that would both claim the
 * same legacy row.
 */
export function diceReconcileKey(event: {
  startDate: string;
  locationName: string | null;
}): string {
  const t = Date.parse(event.startDate);
  const instant = Number.isNaN(t) ? `raw:${event.startDate}` : String(t);
  return `${instant}|${event.locationName ?? ""}`;
}

/** Keys that appear more than once, so neither occurrence may re-key. */
export function duplicateReconcileKeys(
  events: Array<{ startDate: string; locationName: string | null }>,
): Set<string> {
  const seen = new Map<string, number>();
  for (const e of events) {
    const k = diceReconcileKey(e);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

function sameStartInstant(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta === tb;
}

function sameRoom(a: unknown, b: string | null): boolean {
  const left = typeof a === "string" ? a : null;
  return left === (b ?? null);
}

/** A stored row matches the event on start instant and room. */
export function payloadMatchesEvent(
  rawPayload: unknown,
  event: { startDate: string; locationName: string | null },
): boolean {
  if (typeof rawPayload !== "object" || rawPayload === null) return false;
  const p = rawPayload as Record<string, unknown>;
  return (
    sameStartInstant(p["startDate"], event.startDate) &&
    sameRoom(p["locationName"], event.locationName)
  );
}

export type DiceReconcileOutcome =
  | { kind: "rekeyed_ref"; oldId: string; newId: string; showId: string }
  | { kind: "rekeyed_review"; oldId: string; newId: string; reviewId: string }
  | {
      kind: "ambiguous";
      reason:
        | "duplicate_event_key_on_page"
        | "multiple_legacy_refs"
        | "multiple_legacy_reviews";
      candidates: number;
    }
  | { kind: "not_applicable" }
  | { kind: "no_match" };

export type DiceReconcileInput = {
  event: DiceMusicEvent;
  canonicalVenueId: string;
  localDate: Date;
  /** This event shares its key with another event on the same page. */
  duplicateOnPage: boolean;
};

/**
 * Try to move an existing legacy row onto the event's current id.
 *
 * Returns "not_applicable" for a legacy id or an event already linked
 * under its current id, "no_match" when nothing matches (a genuinely new
 * event), and "ambiguous" when more than one row could match.
 */
export async function reconcileDiceEvent(
  input: DiceReconcileInput,
  deps: { prisma: PrismaClient },
): Promise<DiceReconcileOutcome> {
  const { event, canonicalVenueId, localDate } = input;
  const newId = event.providerEventId;

  // Only current-format ids can be re-keyed onto something older.
  if (!isCurrentDiceEventId(newId)) return { kind: "not_applicable" };

  // Already linked under this id: nothing to reconcile, and the normal
  // path will refresh it.
  const alreadyLinked = await deps.prisma.showExternalRef.findUnique({
    where: { provider_providerEventId: { provider: PROVIDER, providerEventId: newId } },
    select: { id: true },
  });
  if (alreadyLinked) return { kind: "not_applicable" };

  if (input.duplicateOnPage) {
    return { kind: "ambiguous", reason: "duplicate_event_key_on_page", candidates: 0 };
  }

  const payload = toDiceRawPayload(event) as unknown as Prisma.InputJsonObject;

  // ── 1. A legacy ref on a show at this venue on this local date ──────
  const refCandidates = await deps.prisma.showExternalRef.findMany({
    where: {
      provider: PROVIDER,
      show: { venueId: canonicalVenueId, localDate },
    },
    select: { id: true, providerEventId: true, showId: true, rawPayload: true },
  });
  const refMatches = refCandidates.filter(
    (r) =>
      isLegacyDiceEventId(r.providerEventId) &&
      payloadMatchesEvent(r.rawPayload, event),
  );
  if (refMatches.length > 1) {
    return {
      kind: "ambiguous",
      reason: "multiple_legacy_refs",
      candidates: refMatches.length,
    };
  }
  if (refMatches.length === 1) {
    const match = refMatches[0]!;
    try {
      await deps.prisma.showExternalRef.update({
        where: { id: match.id },
        // The Show is untouched: same showId, same artist, same date.
        data: { providerEventId: newId, rawPayload: payload },
      });
      return {
        kind: "rekeyed_ref",
        oldId: match.providerEventId,
        newId,
        showId: match.showId,
      };
    } catch (e: unknown) {
      // Lost a race for this id — let the normal path handle it.
      if ((e as { code?: string })?.code === "P2002") return { kind: "no_match" };
      throw e;
    }
  }

  // ── 2. Otherwise a legacy review row for the same event ─────────────
  // Status, reason and candidate shows are preserved: a human decision
  // already recorded must not be reopened just because the id changed.
  const reviewCandidates = await deps.prisma.providerMatchReview.findMany({
    where: { provider: PROVIDER, resolvedVenueId: canonicalVenueId },
    select: { id: true, providerEventId: true, rawPayload: true },
  });
  const reviewMatches = reviewCandidates.filter(
    (r) =>
      isLegacyDiceEventId(r.providerEventId) &&
      payloadMatchesEvent(r.rawPayload, event),
  );
  if (reviewMatches.length > 1) {
    return {
      kind: "ambiguous",
      reason: "multiple_legacy_reviews",
      candidates: reviewMatches.length,
    };
  }
  if (reviewMatches.length === 1) {
    const match = reviewMatches[0]!;
    try {
      await deps.prisma.providerMatchReview.update({
        where: { id: match.id },
        data: { providerEventId: newId, rawPayload: payload },
      });
      return {
        kind: "rekeyed_review",
        oldId: match.providerEventId,
        newId,
        reviewId: match.id,
      };
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "P2002") return { kind: "no_match" };
      throw e;
    }
  }

  return { kind: "no_match" };
}
