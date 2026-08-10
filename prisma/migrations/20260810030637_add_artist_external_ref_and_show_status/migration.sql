-- AlterTable
ALTER TABLE "Show" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'scheduled',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ShowExternalRef" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ArtistExternalRef" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerArtistId" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtistExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtistExternalRef_artistId_idx" ON "ArtistExternalRef"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistExternalRef_provider_providerArtistId_key" ON "ArtistExternalRef"("provider", "providerArtistId");

-- AddForeignKey
ALTER TABLE "ArtistExternalRef" ADD CONSTRAINT "ArtistExternalRef_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: copy the existing per-provider Artist id columns into the
-- provider-neutral ref table.
--
-- The legacy Artist.ticketmasterId / Artist.diceId columns are deliberately
-- KEPT. resolveArtist dual-writes both during the transition, so /shows/confirm
-- and the DICE/Bowery orchestrators keep resolving exactly as before. Dropping
-- the columns is a separate change once nothing reads them.
--
-- Idempotent via ON CONFLICT. At time of writing this moves exactly 1 row
-- (1 artist carries a ticketmasterId, 0 carry a diceId), so there is no
-- realistic collision or performance concern.
-- ---------------------------------------------------------------------------
INSERT INTO "ArtistExternalRef" ("id", "artistId", "provider", "providerArtistId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'ticketmaster', "ticketmasterId", NOW(), NOW()
FROM "Artist"
WHERE "ticketmasterId" IS NOT NULL AND "ticketmasterId" <> ''
ON CONFLICT ("provider", "providerArtistId") DO NOTHING;

INSERT INTO "ArtistExternalRef" ("id", "artistId", "provider", "providerArtistId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'dice', "diceId", NOW(), NOW()
FROM "Artist"
WHERE "diceId" IS NOT NULL AND "diceId" <> ''
ON CONFLICT ("provider", "providerArtistId") DO NOTHING;
