-- ============================================================
-- Migration 003: Departments Table
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  dept_id       VARCHAR(10)   NOT NULL,
  dept_name     VARCHAR(100)  NOT NULL,
  dept_code     VARCHAR(10)   NOT NULL,
  head_user_id  VARCHAR(12)   NULL,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT NOW(),
  updated_at    DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  PRIMARY KEY (dept_id),
  UNIQUE KEY uq_dept_name (dept_name),
  UNIQUE KEY uq_dept_code (dept_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
