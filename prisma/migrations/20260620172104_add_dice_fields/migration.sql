-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "diceId" TEXT;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "lastDiceFetchAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_diceId_key" ON "Artist"("diceId");
