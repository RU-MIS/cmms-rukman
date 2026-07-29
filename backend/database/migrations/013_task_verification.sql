CREATE TABLE IF NOT EXISTS task_verification (
  verify_id   VARCHAR(12) NOT NULL,
  task_id     VARCHAR(12) NOT NULL UNIQUE REFERENCES task_master(task_id),
  verified_by VARCHAR(12) NOT NULL REFERENCES users(user_id),
  verified_at TIMESTAMP   NOT NULL DEFAULT NOW(),
  status      VARCHAR(20) NOT NULL,
  comments    TEXT        NULL,
  PRIMARY KEY (verify_id)
);
