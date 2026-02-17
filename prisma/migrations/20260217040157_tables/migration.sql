-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'ALLOWED', 'WARNED', 'BLOCKED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticketmasterId" TEXT,
    "mbid" TEXT,
    "mbidConfidence" DOUBLE PRECISION,
    "lastMbidLookupAt" TIMESTAMP(3),

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Show" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "startDatetimeUtc" TIMESTAMP(3) NOT NULL,
    "localDate" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Show_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowExternalRef" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "rawPayload" JSONB,

    CONSTRAINT "ShowExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "ratingOverall" INTEGER NOT NULL,
    "reviewTextRaw" TEXT NOT NULL,
    "tags" JSONB,
    "highlights" JSONB,
    "categoryScores" JSONB,
    "sentiment" TEXT,
    "summary" TEXT,
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "moderationFlags" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetlistCache" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "setlist" JSONB,
    "fetchedAt" TIMESTAMP(3),

    CONSTRAINT "SetlistCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_ticketmasterId_key" ON "Artist"("ticketmasterId");

-- CreateIndex
CREATE INDEX "Show_localDate_idx" ON "Show"("localDate");

-- CreateIndex
CREATE UNIQUE INDEX "Show_artistId_venueId_localDate_key" ON "Show"("artistId", "venueId", "localDate");

-- CreateIndex
CREATE INDEX "ShowExternalRef_showId_idx" ON "ShowExternalRef"("showId");

-- CreateIndex
CREATE UNIQUE INDEX "ShowExternalRef_provider_providerEventId_key" ON "ShowExternalRef"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "Review_publishedAt_idx" ON "Review"("publishedAt");

-- CreateIndex
CREATE INDEX "Review_showId_idx" ON "Review"("showId");

-- CreateIndex
CREATE INDEX "Review_userId_idx" ON "Review"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SetlistCache_showId_key" ON "SetlistCache"("showId");

-- AddForeignKey
ALTER TABLE "Show" ADD CONSTRAINT "Show_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Show" ADD CONSTRAINT "Show_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowExternalRef" ADD CONSTRAINT "ShowExternalRef_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetlistCache" ADD CONSTRAINT "SetlistCache_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
