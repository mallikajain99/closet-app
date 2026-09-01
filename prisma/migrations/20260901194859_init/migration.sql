-- CreateEnum
CREATE TYPE "Category" AS ENUM ('TOP', 'BOTTOM', 'DRESS', 'OUTERWEAR', 'SHOE', 'HAT', 'BAG', 'JEWELRY', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "Slot" AS ENUM ('HEAD', 'TOP', 'OUTER', 'BOTTOM', 'SHOES', 'BAG', 'JEWELRY', 'OTHER');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'LAUNDRY', 'REPAIR', 'DONATED', 'SOLD');

-- CreateEnum
CREATE TYPE "Season" AS ENUM ('SPRING', 'SUMMER', 'FALL', 'WINTER');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "ImageSubject" AS ENUM ('ITEM', 'OOTD');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "neglectedThresholdDays" INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "subcategory" TEXT,
    "brand" TEXT,
    "size" TEXT,
    "colors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seasons" "Season"[] DEFAULT ARRAY[]::"Season"[],
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "purchaseDate" DATE,
    "sourceUrl" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "conditionNote" TEXT,
    "returnByDate" DATE,
    "originalImageKey" TEXT,
    "processedImageKey" TEXT,
    "thumbnailKey" TEXT,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "layoutScale" DOUBLE PRECISION,
    "layoutOffsetX" DOUBLE PRECISION,
    "layoutOffsetY" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_tags" (
    "itemId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "item_tags_pkey" PRIMARY KEY ("itemId","tagId")
);

-- CreateTable
CREATE TABLE "outfits" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "currentVersionId" UUID,

    CONSTRAINT "outfits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfit_versions" (
    "id" UUID NOT NULL,
    "outfitId" UUID NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "outfit_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfit_items" (
    "id" UUID NOT NULL,
    "outfitVersionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "slot" "Slot" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outfit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfit_tags" (
    "outfitId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "outfit_tags_pkey" PRIMARY KEY ("outfitId","tagId")
);

-- CreateTable
CREATE TABLE "wear_logs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "wornOn" DATE NOT NULL,
    "outfitId" UUID,
    "outfitVersionId" UUID,
    "note" TEXT,
    "ootdOriginalImageKey" TEXT,
    "ootdProcessedImageKey" TEXT,
    "ootdProcessingStatus" "ProcessingStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wear_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wear_log_items" (
    "wearLogId" UUID NOT NULL,
    "itemId" UUID NOT NULL,

    CONSTRAINT "wear_log_items_pkey" PRIMARY KEY ("wearLogId","itemId")
);

-- CreateTable
CREATE TABLE "image_jobs" (
    "id" UUID NOT NULL,
    "subjectType" "ImageSubject" NOT NULL,
    "subjectId" UUID NOT NULL,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "step" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "image_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "items_userId_category_idx" ON "items"("userId", "category");

-- CreateIndex
CREATE INDEX "items_userId_brand_idx" ON "items"("userId", "brand");

-- CreateIndex
CREATE INDEX "items_userId_status_idx" ON "items"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tags_userId_name_key" ON "tags"("userId", "name");

-- CreateIndex
CREATE INDEX "item_tags_tagId_idx" ON "item_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "outfits_currentVersionId_key" ON "outfits"("currentVersionId");

-- CreateIndex
CREATE INDEX "outfits_userId_idx" ON "outfits"("userId");

-- CreateIndex
CREATE INDEX "outfit_versions_outfitId_idx" ON "outfit_versions"("outfitId");

-- CreateIndex
CREATE INDEX "outfit_versions_signature_idx" ON "outfit_versions"("signature");

-- CreateIndex
CREATE INDEX "outfit_items_itemId_idx" ON "outfit_items"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "outfit_items_outfitVersionId_itemId_key" ON "outfit_items"("outfitVersionId", "itemId");

-- CreateIndex
CREATE INDEX "outfit_tags_tagId_idx" ON "outfit_tags"("tagId");

-- CreateIndex
CREATE INDEX "wear_logs_userId_wornOn_idx" ON "wear_logs"("userId", "wornOn");

-- CreateIndex
CREATE INDEX "wear_logs_outfitId_idx" ON "wear_logs"("outfitId");

-- CreateIndex
CREATE INDEX "wear_logs_outfitVersionId_idx" ON "wear_logs"("outfitVersionId");

-- CreateIndex
CREATE INDEX "wear_log_items_itemId_idx" ON "wear_log_items"("itemId");

-- CreateIndex
CREATE INDEX "image_jobs_subjectType_subjectId_idx" ON "image_jobs"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "image_jobs_status_idx" ON "image_jobs"("status");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfits" ADD CONSTRAINT "outfits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfits" ADD CONSTRAINT "outfits_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "outfit_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_versions" ADD CONSTRAINT "outfit_versions_outfitId_fkey" FOREIGN KEY ("outfitId") REFERENCES "outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_items" ADD CONSTRAINT "outfit_items_outfitVersionId_fkey" FOREIGN KEY ("outfitVersionId") REFERENCES "outfit_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_items" ADD CONSTRAINT "outfit_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_tags" ADD CONSTRAINT "outfit_tags_outfitId_fkey" FOREIGN KEY ("outfitId") REFERENCES "outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_tags" ADD CONSTRAINT "outfit_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wear_logs" ADD CONSTRAINT "wear_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wear_logs" ADD CONSTRAINT "wear_logs_outfitId_fkey" FOREIGN KEY ("outfitId") REFERENCES "outfits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wear_logs" ADD CONSTRAINT "wear_logs_outfitVersionId_fkey" FOREIGN KEY ("outfitVersionId") REFERENCES "outfit_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wear_log_items" ADD CONSTRAINT "wear_log_items_wearLogId_fkey" FOREIGN KEY ("wearLogId") REFERENCES "wear_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wear_log_items" ADD CONSTRAINT "wear_log_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
