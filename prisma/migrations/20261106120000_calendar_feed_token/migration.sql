-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "calendarFeedCreatedAt" TIMESTAMP(3),
ADD COLUMN     "calendarFeedHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_calendarFeedHash_key" ON "UserProfile"("calendarFeedHash");
