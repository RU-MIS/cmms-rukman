-- ============================================================
-- Migration 001: Settings Table
-- Key-value store for app config + ID counters
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  `key`         VARCHAR(100)  NOT NULL,
  `value`       TEXT          NOT NULL,
  description   VARCHAR(255)  NULL,
  updated_at    DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
