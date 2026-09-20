-- AlterTable
ALTER TABLE "items" ADD COLUMN     "renderHeight" INTEGER,
ADD COLUMN     "renderWidth" INTEGER;

-- AlterTable
ALTER TABLE "tags" ADD COLUMN     "autoNamed" BOOLEAN NOT NULL DEFAULT true;
