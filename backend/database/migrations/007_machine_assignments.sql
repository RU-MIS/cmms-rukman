CREATE TABLE IF NOT EXISTS machine_assignments (
  assign_id       VARCHAR(12) NOT NULL,
  machine_id      VARCHAR(12) NOT NULL REFERENCES machines(machine_id),
  user_id         VARCHAR(12) NOT NULL REFERENCES users(user_id),
  assigned_date   DATE        NOT NULL,
  unassigned_date DATE        NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  assigned_by     VARCHAR(12) NULL,
  handover_notes  TEXT        NULL,
  created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assign_id)
);
