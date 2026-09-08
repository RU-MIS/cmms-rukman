-- AlterTable
ALTER TABLE `Product` ADD COLUMN `batchTracked` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `itemType` ENUM('RAW_MATERIAL', 'COMPONENT', 'CONSUMABLE', 'SEMI_FINISHED_GOODS', 'FINISHED_GOODS', 'SCRAP', 'OTHER') NOT NULL DEFAULT 'OTHER',
    ADD COLUMN `maxStockLevel` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    ADD COLUMN `minStockLevel` DECIMAL(14, 3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `ProductCategory` ADD COLUMN `parentId` INTEGER NULL;

-- AlterTable
ALTER TABLE `ProductionPlan` ADD COLUMN `batchNumber` VARCHAR(191) NULL,
    ADD COLUMN `departmentId` INTEGER NULL,
    ADD COLUMN `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    ADD COLUMN `startDate` DATETIME(3) NULL,
    ADD COLUMN `supervisorId` INTEGER NULL,
    ADD COLUMN `workOrderNumber` VARCHAR(191) NULL,
    MODIFY `status` ENUM('DRAFT', 'PLANNED', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'ON_HOLD', 'CANCELLED') NOT NULL DEFAULT 'PLANNED';

-- AlterTable
ALTER TABLE `StockTransaction` ADD COLUMN `batchNumber` VARCHAR(191) NULL,
    ADD COLUMN `lotNumber` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `departmentId` INTEGER NULL,
    ADD COLUMN `employeeCode` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Warehouse` ADD COLUMN `departmentId` INTEGER NULL;

-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Department_name_key`(`name`),
    UNIQUE INDEX `Department_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserModuleAccess` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `canView` BOOLEAN NOT NULL DEFAULT true,
    `canCreate` BOOLEAN NOT NULL DEFAULT false,
    `canEdit` BOOLEAN NOT NULL DEFAULT false,
    `canDelete` BOOLEAN NOT NULL DEFAULT false,
    `canApprove` BOOLEAN NOT NULL DEFAULT false,
    `canSubmit` BOOLEAN NOT NULL DEFAULT false,
    `canVerify` BOOLEAN NOT NULL DEFAULT false,
    `canExport` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserModuleAccess_userId_module_key`(`userId`, `module`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserProcessAccess` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `processId` INTEGER NOT NULL,
    `canView` BOOLEAN NOT NULL DEFAULT true,
    `canCreate` BOOLEAN NOT NULL DEFAULT false,
    `canEdit` BOOLEAN NOT NULL DEFAULT false,
    `canDelete` BOOLEAN NOT NULL DEFAULT false,
    `canApprove` BOOLEAN NOT NULL DEFAULT false,
    `canSubmit` BOOLEAN NOT NULL DEFAULT false,
    `canVerify` BOOLEAN NOT NULL DEFAULT false,
    `canExport` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserProcessAccess_userId_processId_key`(`userId`, `processId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Process` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `departmentId` INTEGER NULL,
    `sequence` INTEGER NOT NULL DEFAULT 1,
    `previousProcessId` INTEGER NULL,
    `responsibleRoleId` INTEGER NULL,
    `expectedCompletionMinutes` INTEGER NULL,
    `requiredMaterial` VARCHAR(191) NULL,
    `outputMaterial` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isMandatory` BOOLEAN NOT NULL DEFAULT true,
    `remarks` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Process_code_key`(`code`),
    INDEX `Process_sequence_idx`(`sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FmsProcessEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entryNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processId` INTEGER NOT NULL,
    `departmentId` INTEGER NULL,
    `productId` INTEGER NOT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `workOrderNumber` VARCHAR(191) NULL,
    `previousProcessId` INTEGER NULL,
    `nextProcessId` INTEGER NULL,
    `openingQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `receivedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `processedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `completedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `rejectedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `reworkQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `shortageQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `excessQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `startTime` DATETIME(3) NULL,
    `endTime` DATETIME(3) NULL,
    `responsibleUserId` INTEGER NULL,
    `verifiedById` INTEGER NULL,
    `status` ENUM('NOT_STARTED', 'ASSIGNED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'ON_HOLD', 'REWORK', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'NOT_STARTED',
    `remarks` VARCHAR(191) NULL,
    `attachmentUrl` VARCHAR(191) NULL,
    `productionEntryId` INTEGER NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FmsProcessEntry_entryNo_key`(`entryNo`),
    UNIQUE INDEX `FmsProcessEntry_productionEntryId_key`(`productionEntryId`),
    INDEX `FmsProcessEntry_processId_date_idx`(`processId`, `date`),
    INDEX `FmsProcessEntry_status_idx`(`status`),
    INDEX `FmsProcessEntry_batchNumber_idx`(`batchNumber`),
    INDEX `FmsProcessEntry_workOrderNumber_idx`(`workOrderNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FmsHandover` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `handoverNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sourceDepartmentId` INTEGER NOT NULL,
    `destDepartmentId` INTEGER NOT NULL,
    `sourceProcessId` INTEGER NULL,
    `destProcessId` INTEGER NULL,
    `fmsProcessEntryId` INTEGER NULL,
    `productId` INTEGER NOT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `quantity` DECIMAL(14, 3) NOT NULL,
    `handoverUserId` INTEGER NOT NULL,
    `receivingUserId` INTEGER NULL,
    `acceptedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `rejectedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `remarks` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'DISCREPANCY', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `stockTransferId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FmsHandover_handoverNo_key`(`handoverNo`),
    UNIQUE INDEX `FmsHandover_stockTransferId_key`(`stockTransferId`),
    INDEX `FmsHandover_status_idx`(`status`),
    INDEX `FmsHandover_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DepartmentStockBalance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `warehouseId` INTEGER NULL,
    `openingStock` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `currentStock` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `reservedStock` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `damagedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `rejectedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DepartmentStockBalance_productId_departmentId_key`(`productId`, `departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransfer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `transferNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fromWarehouseId` INTEGER NOT NULL,
    `toWarehouseId` INTEGER NOT NULL,
    `fromDepartmentId` INTEGER NULL,
    `toDepartmentId` INTEGER NULL,
    `reason` VARCHAR(191) NULL,
    `productionPlanId` INTEGER NULL,
    `sentById` INTEGER NOT NULL,
    `receivedById` INTEGER NULL,
    `status` ENUM('DRAFT', 'REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'PARTIALLY_RECEIVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `remarks` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StockTransfer_transferNo_key`(`transferNo`),
    INDEX `StockTransfer_status_idx`(`status`),
    INDEX `StockTransfer_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransferItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `stockTransferId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `qty` DECIMAL(14, 3) NOT NULL,
    `acceptedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `rejectedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductionEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entryNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `planId` INTEGER NULL,
    `productId` INTEGER NOT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `workOrderNumber` VARCHAR(191) NULL,
    `departmentId` INTEGER NULL,
    `processId` INTEGER NULL,
    `targetQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `producedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `rejectedQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `reworkQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `scrapQty` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `startTime` DATETIME(3) NULL,
    `endTime` DATETIME(3) NULL,
    `operatorId` INTEGER NULL,
    `supervisorId` INTEGER NULL,
    `qualityStatus` ENUM('PENDING', 'PASSED', 'FAILED', 'PARTIAL') NOT NULL DEFAULT 'PENDING',
    `remarks` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductionEntry_entryNo_key`(`entryNo`),
    INDEX `ProductionEntry_planId_idx`(`planId`),
    INDEX `ProductionEntry_processId_idx`(`processId`),
    INDEX `ProductionEntry_batchNumber_idx`(`batchNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RejectionRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `productId` INTEGER NOT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `processId` INTEGER NULL,
    `productionEntryId` INTEGER NULL,
    `rejectedQty` DECIMAL(14, 3) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `rejectedById` INTEGER NULL,
    `remarks` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RejectionRecord_productId_date_idx`(`productId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReworkRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `productId` INTEGER NOT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `processId` INTEGER NULL,
    `productionEntryId` INTEGER NULL,
    `reworkQty` DECIMAL(14, 3) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `assignedDepartmentId` INTEGER NULL,
    `assignedUserId` INTEGER NULL,
    `completionStatus` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `remarks` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReworkRecord_productId_date_idx`(`productId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_ProcessResponsibleUsers` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_ProcessResponsibleUsers_AB_unique`(`A`, `B`),
    INDEX `_ProcessResponsibleUsers_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `StockTransaction_batchNumber_idx` ON `StockTransaction`(`batchNumber`);

-- CreateIndex
CREATE UNIQUE INDEX `User_employeeCode_key` ON `User`(`employeeCode`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductCategory` ADD CONSTRAINT `ProductCategory_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `ProductCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Warehouse` ADD CONSTRAINT `Warehouse_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionPlan` ADD CONSTRAINT `ProductionPlan_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionPlan` ADD CONSTRAINT `ProductionPlan_supervisorId_fkey` FOREIGN KEY (`supervisorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserModuleAccess` ADD CONSTRAINT `UserModuleAccess_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserProcessAccess` ADD CONSTRAINT `UserProcessAccess_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserProcessAccess` ADD CONSTRAINT `UserProcessAccess_processId_fkey` FOREIGN KEY (`processId`) REFERENCES `Process`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Process` ADD CONSTRAINT `Process_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Process` ADD CONSTRAINT `Process_previousProcessId_fkey` FOREIGN KEY (`previousProcessId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Process` ADD CONSTRAINT `Process_responsibleRoleId_fkey` FOREIGN KEY (`responsibleRoleId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsProcessEntry` ADD CONSTRAINT `FmsProcessEntry_processId_fkey` FOREIGN KEY (`processId`) REFERENCES `Process`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsProcessEntry` ADD CONSTRAINT `FmsProcessEntry_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsProcessEntry` ADD CONSTRAINT `FmsProcessEntry_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsProcessEntry` ADD CONSTRAINT `FmsProcessEntry_previousProcessId_fkey` FOREIGN KEY (`previousProcessId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsProcessEntry` ADD CONSTRAINT `FmsProcessEntry_nextProcessId_fkey` FOREIGN KEY (`nextProcessId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsProcessEntry` ADD CONSTRAINT `FmsProcessEntry_responsibleUserId_fkey` FOREIGN KEY (`responsibleUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsProcessEntry` ADD CONSTRAINT `FmsProcessEntry_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsProcessEntry` ADD CONSTRAINT `FmsProcessEntry_productionEntryId_fkey` FOREIGN KEY (`productionEntryId`) REFERENCES `ProductionEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsProcessEntry` ADD CONSTRAINT `FmsProcessEntry_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsHandover` ADD CONSTRAINT `FmsHandover_sourceDepartmentId_fkey` FOREIGN KEY (`sourceDepartmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsHandover` ADD CONSTRAINT `FmsHandover_destDepartmentId_fkey` FOREIGN KEY (`destDepartmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsHandover` ADD CONSTRAINT `FmsHandover_sourceProcessId_fkey` FOREIGN KEY (`sourceProcessId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsHandover` ADD CONSTRAINT `FmsHandover_destProcessId_fkey` FOREIGN KEY (`destProcessId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsHandover` ADD CONSTRAINT `FmsHandover_fmsProcessEntryId_fkey` FOREIGN KEY (`fmsProcessEntryId`) REFERENCES `FmsProcessEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsHandover` ADD CONSTRAINT `FmsHandover_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsHandover` ADD CONSTRAINT `FmsHandover_handoverUserId_fkey` FOREIGN KEY (`handoverUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsHandover` ADD CONSTRAINT `FmsHandover_receivingUserId_fkey` FOREIGN KEY (`receivingUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FmsHandover` ADD CONSTRAINT `FmsHandover_stockTransferId_fkey` FOREIGN KEY (`stockTransferId`) REFERENCES `StockTransfer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepartmentStockBalance` ADD CONSTRAINT `DepartmentStockBalance_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepartmentStockBalance` ADD CONSTRAINT `DepartmentStockBalance_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepartmentStockBalance` ADD CONSTRAINT `DepartmentStockBalance_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_fromWarehouseId_fkey` FOREIGN KEY (`fromWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_toWarehouseId_fkey` FOREIGN KEY (`toWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_fromDepartmentId_fkey` FOREIGN KEY (`fromDepartmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_toDepartmentId_fkey` FOREIGN KEY (`toDepartmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_sentById_fkey` FOREIGN KEY (`sentById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_receivedById_fkey` FOREIGN KEY (`receivedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferItem` ADD CONSTRAINT `StockTransferItem_stockTransferId_fkey` FOREIGN KEY (`stockTransferId`) REFERENCES `StockTransfer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferItem` ADD CONSTRAINT `StockTransferItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionEntry` ADD CONSTRAINT `ProductionEntry_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `ProductionPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionEntry` ADD CONSTRAINT `ProductionEntry_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionEntry` ADD CONSTRAINT `ProductionEntry_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionEntry` ADD CONSTRAINT `ProductionEntry_processId_fkey` FOREIGN KEY (`processId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionEntry` ADD CONSTRAINT `ProductionEntry_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionEntry` ADD CONSTRAINT `ProductionEntry_supervisorId_fkey` FOREIGN KEY (`supervisorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RejectionRecord` ADD CONSTRAINT `RejectionRecord_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RejectionRecord` ADD CONSTRAINT `RejectionRecord_processId_fkey` FOREIGN KEY (`processId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RejectionRecord` ADD CONSTRAINT `RejectionRecord_productionEntryId_fkey` FOREIGN KEY (`productionEntryId`) REFERENCES `ProductionEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RejectionRecord` ADD CONSTRAINT `RejectionRecord_rejectedById_fkey` FOREIGN KEY (`rejectedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReworkRecord` ADD CONSTRAINT `ReworkRecord_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReworkRecord` ADD CONSTRAINT `ReworkRecord_processId_fkey` FOREIGN KEY (`processId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReworkRecord` ADD CONSTRAINT `ReworkRecord_productionEntryId_fkey` FOREIGN KEY (`productionEntryId`) REFERENCES `ProductionEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReworkRecord` ADD CONSTRAINT `ReworkRecord_assignedDepartmentId_fkey` FOREIGN KEY (`assignedDepartmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReworkRecord` ADD CONSTRAINT `ReworkRecord_assignedUserId_fkey` FOREIGN KEY (`assignedUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ProcessResponsibleUsers` ADD CONSTRAINT `_ProcessResponsibleUsers_A_fkey` FOREIGN KEY (`A`) REFERENCES `Process`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ProcessResponsibleUsers` ADD CONSTRAINT `_ProcessResponsibleUsers_B_fkey` FOREIGN KEY (`B`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

