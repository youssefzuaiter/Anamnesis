-- CreateTable
CREATE TABLE "WeeklyGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyGoal_userId_measure_key" ON "WeeklyGoal"("userId", "measure");

-- AddForeignKey
ALTER TABLE "WeeklyGoal" ADD CONSTRAINT "WeeklyGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Targets are whole numbers from 1 to 999.
ALTER TABLE "WeeklyGoal" ADD CONSTRAINT "WeeklyGoal_target_check" CHECK ("target" BETWEEN 1 AND 999);
