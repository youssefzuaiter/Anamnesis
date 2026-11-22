-- Locked notes (ROADMAP item 58). Additive and with a default, so the previous release keeps working.
ALTER TABLE "Note" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;
