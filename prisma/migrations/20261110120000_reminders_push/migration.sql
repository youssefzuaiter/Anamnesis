-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "ntfyTopic" TEXT,
ADD COLUMN     "pushDigestHour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushLeadMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "pushShowTitles" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_ntfyTopic_key" ON "UserProfile"("ntfyTopic");

-- CreateIndex
CREATE INDEX "ReminderDelivery_createdAt_idx" ON "ReminderDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_userId_key_key" ON "ReminderDelivery"("userId", "key");

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
