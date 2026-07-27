-- ============================================================
-- Migration 002: Roles Table
-- ============================================================

CREATE TABLE IF NOT EXISTS roles (
  role_id       VARCHAR(10)   NOT NULL,
  role_name     VARCHAR(50)   NOT NULL,
  permissions   JSON          NOT NULL DEFAULT ('{}'),
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id),
  UNIQUE KEY uq_role_name (role_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
