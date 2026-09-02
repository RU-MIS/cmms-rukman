-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "pdfFont" TEXT NOT NULL DEFAULT 'Helvetica',
ADD COLUMN     "pdfScale" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "termsConditions" TEXT;
