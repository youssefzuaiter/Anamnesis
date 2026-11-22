-- Which areas of life the account keeps (ROADMAP item 56). Nullable and additive: NULL means school.
ALTER TABLE "UserProfile" ADD COLUMN "areas" TEXT;
