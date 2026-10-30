-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "credits" DOUBLE PRECISION,
ADD COLUMN     "finalGrade" TEXT;

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "gpaScale" JSONB,
ADD COLUMN     "targetGpa" DOUBLE PRECISION;
