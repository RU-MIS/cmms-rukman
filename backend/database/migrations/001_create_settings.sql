CREATE TABLE IF NOT EXISTS settings (
  key         VARCHAR(100)  NOT NULL,
  value       TEXT          NOT NULL,
  description VARCHAR(255)  NULL,
  updated_at  TIMESTAMP     NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key)
);
