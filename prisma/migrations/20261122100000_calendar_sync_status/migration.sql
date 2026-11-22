-- AlterTable: when a calendar link was last tried and why the last try failed, for the scheduled sync (ROADMAP item 54).
-- Both are nullable, so the previous release, which does not know them, keeps working.
ALTER TABLE "CalendarSubscription" ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT;
