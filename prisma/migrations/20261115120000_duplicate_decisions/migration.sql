-- CreateTable
CREATE TABLE "DuplicateDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteAId" TEXT NOT NULL,
    "noteBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DuplicateDecision_userId_idx" ON "DuplicateDecision"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateDecision_userId_noteAId_noteBId_key" ON "DuplicateDecision"("userId", "noteAId", "noteBId");

-- AddForeignKey
ALTER TABLE "DuplicateDecision" ADD CONSTRAINT "DuplicateDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateDecision" ADD CONSTRAINT "DuplicateDecision_noteAId_fkey" FOREIGN KEY ("noteAId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateDecision" ADD CONSTRAINT "DuplicateDecision_noteBId_fkey" FOREIGN KEY ("noteBId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

