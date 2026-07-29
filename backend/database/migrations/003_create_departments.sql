CREATE TABLE IF NOT EXISTS departments (
  dept_id      VARCHAR(10)  NOT NULL,
  dept_name    VARCHAR(100) NOT NULL UNIQUE,
  dept_code    VARCHAR(10)  NOT NULL UNIQUE,
  head_user_id VARCHAR(12)  NULL,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dept_id)
);
