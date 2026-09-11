-- Adds 17 columns that exist in schema.prisma but were never actually
-- applied to the live database (they were only ever declared inside
-- 20260905065927_init_multi_tenant's CREATE TABLE statements, and that
-- migration was marked applied without its SQL ever running against the
-- real database -- see the read-only diagnosis for full detail).
--
-- Written with information_schema guards (not a plain ADD COLUMN) because
-- a freshly-built database (e.g. the test suite, which applies every
-- migration from scratch) already gets these columns from
-- init_multi_tenant's CREATE TABLE -- a plain ADD COLUMN would collide
-- with them there. On the real database, where init_multi_tenant's SQL
-- never ran, the guard finds the columns missing and adds them for real.
-- Either way this migration is idempotent and safe to re-run.

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='Purchase' AND column_name='vendorBillDate');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `Purchase` ADD COLUMN `vendorBillDate` DATETIME(3) NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='SalesOrder' AND column_name='subtotal');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `SalesOrder` ADD COLUMN `subtotal` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='SalesOrder' AND column_name='discount');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `SalesOrder` ADD COLUMN `discount` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='SalesOrder' AND column_name='taxAmount');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `SalesOrder` ADD COLUMN `taxAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='SalesOrder' AND column_name='grandTotal');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `SalesOrder` ADD COLUMN `grandTotal` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='PurchaseOrder' AND column_name='subtotal');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `PurchaseOrder` ADD COLUMN `subtotal` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='PurchaseOrder' AND column_name='discount');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `PurchaseOrder` ADD COLUMN `discount` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='PurchaseOrder' AND column_name='taxAmount');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `PurchaseOrder` ADD COLUMN `taxAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='PurchaseOrder' AND column_name='grandTotal');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `PurchaseOrder` ADD COLUMN `grandTotal` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='SalesOrderItem' AND column_name='discount');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `SalesOrderItem` ADD COLUMN `discount` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='SalesOrderItem' AND column_name='taxRate');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `SalesOrderItem` ADD COLUMN `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='SalesOrderItem' AND column_name='taxAmount');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `SalesOrderItem` ADD COLUMN `taxAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='SalesOrderItem' AND column_name='total');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `SalesOrderItem` ADD COLUMN `total` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='PurchaseOrderItem' AND column_name='discount');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `PurchaseOrderItem` ADD COLUMN `discount` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='PurchaseOrderItem' AND column_name='taxRate');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `PurchaseOrderItem` ADD COLUMN `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='PurchaseOrderItem' AND column_name='taxAmount');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `PurchaseOrderItem` ADD COLUMN `taxAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='PurchaseOrderItem' AND column_name='total');
SET @sql := IF(@col_exists=0, 'ALTER TABLE `PurchaseOrderItem` ADD COLUMN `total` DECIMAL(14, 2) NOT NULL DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
