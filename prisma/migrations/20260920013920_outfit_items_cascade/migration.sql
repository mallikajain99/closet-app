-- DropForeignKey
ALTER TABLE "outfit_items" DROP CONSTRAINT "outfit_items_itemId_fkey";

-- AddForeignKey
ALTER TABLE "outfit_items" ADD CONSTRAINT "outfit_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
