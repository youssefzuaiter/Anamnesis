-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "assessmentId" TEXT;

-- CreateIndex
CREATE INDEX "Task_assessmentId_idx" ON "Task"("assessmentId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
