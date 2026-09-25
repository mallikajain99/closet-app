-- CreateEnum
CREATE TYPE "PieceMatch" AS ENUM ('MISSING', 'CLOSE', 'OWNED');

-- CreateTable
CREATE TABLE "inspirations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "imageKey" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "note" TEXT,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspirations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspiration_pieces" (
    "id" UUID NOT NULL,
    "inspirationId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "color" TEXT,
    "match" "PieceMatch" NOT NULL DEFAULT 'MISSING',
    "matchedItemId" UUID,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "boughtAt" TIMESTAMP(3),
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "inspiration_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inspirations_userId_idx" ON "inspirations"("userId");

-- CreateIndex
CREATE INDEX "inspiration_pieces_inspirationId_idx" ON "inspiration_pieces"("inspirationId");

-- CreateIndex
CREATE INDEX "inspiration_pieces_matchedItemId_idx" ON "inspiration_pieces"("matchedItemId");

-- AddForeignKey
ALTER TABLE "inspirations" ADD CONSTRAINT "inspirations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspiration_pieces" ADD CONSTRAINT "inspiration_pieces_inspirationId_fkey" FOREIGN KEY ("inspirationId") REFERENCES "inspirations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspiration_pieces" ADD CONSTRAINT "inspiration_pieces_matchedItemId_fkey" FOREIGN KEY ("matchedItemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
