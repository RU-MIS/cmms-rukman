CREATE TABLE IF NOT EXISTS audit_logs (
  log_id     VARCHAR(12)  NOT NULL,
  user_id    VARCHAR(12)  NULL,
  action     VARCHAR(20)  NOT NULL,
  module     VARCHAR(50)  NOT NULL,
  record_id  VARCHAR(12)  NULL,
  old_value  JSONB        NULL,
  new_value  JSONB        NULL,
  ip_address VARCHAR(45)  NULL,
  session_id VARCHAR(100) NULL,
  timestamp  TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (log_id)
);
