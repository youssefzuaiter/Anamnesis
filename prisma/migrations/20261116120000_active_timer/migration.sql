-- CreateTable
CREATE TABLE "ActiveTimer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "phase" TEXT NOT NULL,
    "focusMinutes" INTEGER NOT NULL,
    "phaseSeconds" INTEGER NOT NULL,
    "endsAt" TIMESTAMP(3),
    "pausedRemaining" INTEGER,
    "finishedAt" TIMESTAMP(3),
    "completedFocus" INTEGER NOT NULL DEFAULT 0,
    "savedSeconds" INTEGER NOT NULL DEFAULT 0,
    "notifyPhone" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveTimer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActiveTimer_userId_key" ON "ActiveTimer"("userId");

-- AddForeignKey
ALTER TABLE "ActiveTimer" ADD CONSTRAINT "ActiveTimer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one of running (endsAt), paused or ready (pausedRemaining) and finished (finishedAt): a timer is never two of them or none.
ALTER TABLE "ActiveTimer" ADD CONSTRAINT "ActiveTimer_one_state_check" CHECK (
    (("endsAt" IS NOT NULL)::int + ("pausedRemaining" IS NOT NULL)::int + ("finishedAt" IS NOT NULL)::int) = 1
);
