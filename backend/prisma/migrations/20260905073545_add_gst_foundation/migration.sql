-- AlterTable
ALTER TABLE `Company` ADD COLUMN `natureOfBusiness` VARCHAR(191) NULL,
    ADD COLUMN `principalPlaceOfBusiness` VARCHAR(191) NULL,
    ADD COLUMN `registrationDate` DATETIME(3) NULL,
    ADD COLUMN `registrationStatus` VARCHAR(191) NULL;
