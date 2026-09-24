-- CreateTable
CREATE TABLE "outfit_photos" (
    "id" UUID NOT NULL,
    "outfitId" UUID NOT NULL,
    "imageKey" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outfit_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outfit_photos_outfitId_idx" ON "outfit_photos"("outfitId");

-- AddForeignKey
ALTER TABLE "outfit_photos" ADD CONSTRAINT "outfit_photos_outfitId_fkey" FOREIGN KEY ("outfitId") REFERENCES "outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
