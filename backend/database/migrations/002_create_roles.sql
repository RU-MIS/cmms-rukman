CREATE TABLE IF NOT EXISTS roles (
  role_id     VARCHAR(10)   NOT NULL,
  role_name   VARCHAR(50)   NOT NULL UNIQUE,
  permissions JSONB         NOT NULL DEFAULT '{}',
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP     NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id)
);
