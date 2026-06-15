-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "lastSetlistfmFetchAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SetlistCache" ADD COLUMN     "sourceUrl" TEXT;

-- CreateTable
CREATE TABLE "VenueExternalRef" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerVenueId" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderMatchReview" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "candidateShowIds" TEXT[],
    "resolvedArtistId" TEXT,
    "resolvedVenueId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "ProviderMatchReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VenueExternalRef_venueId_idx" ON "VenueExternalRef"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "VenueExternalRef_provider_providerVenueId_key" ON "VenueExternalRef"("provider", "providerVenueId");

-- CreateIndex
CREATE INDEX "ProviderMatchReview_status_createdAt_idx" ON "ProviderMatchReview"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderMatchReview_provider_providerEventId_key" ON "ProviderMatchReview"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "VenueExternalRef" ADD CONSTRAINT "VenueExternalRef_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderMatchReview" ADD CONSTRAINT "ProviderMatchReview_resolvedArtistId_fkey" FOREIGN KEY ("resolvedArtistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderMatchReview" ADD CONSTRAINT "ProviderMatchReview_resolvedVenueId_fkey" FOREIGN KEY ("resolvedVenueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
