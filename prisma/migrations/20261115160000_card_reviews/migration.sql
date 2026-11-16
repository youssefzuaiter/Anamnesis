-- CreateTable
CREATE TABLE "CardReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT,
    "grade" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardReview_userId_reviewedAt_idx" ON "CardReview"("userId", "reviewedAt");

-- AddForeignKey
ALTER TABLE "CardReview" ADD CONSTRAINT "CardReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: a card that already has a review date gets one line for it, with no grade, so the stats page does not start empty.
INSERT INTO "CardReview" ("id", "userId", "cardId", "grade", "reviewedAt")
SELECT gen_random_uuid()::text, "userId", "id", NULL, "lastReviewed"
FROM "Flashcard"
WHERE "lastReviewed" IS NOT NULL;
