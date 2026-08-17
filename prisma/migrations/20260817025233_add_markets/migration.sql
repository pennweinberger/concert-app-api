-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "marketDecidedAt" TIMESTAMP(3),
ADD COLUMN     "state" TEXT;

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueMarket" (
    "venueId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "assignedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueMarket_pkey" PRIMARY KEY ("venueId","marketId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Market_slug_key" ON "Market"("slug");

-- CreateIndex
CREATE INDEX "VenueMarket_marketId_idx" ON "VenueMarket"("marketId");

-- CreateIndex
CREATE INDEX "Venue_marketDecidedAt_idx" ON "Venue"("marketDecidedAt");

-- AddForeignKey
ALTER TABLE "VenueMarket" ADD CONSTRAINT "VenueMarket_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueMarket" ADD CONSTRAINT "VenueMarket_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
