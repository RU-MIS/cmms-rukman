CREATE TABLE IF NOT EXISTS task_master (
  task_id              VARCHAR(12) NOT NULL,
  machine_id           VARCHAR(12) NOT NULL REFERENCES machines(machine_id),
  template_id          VARCHAR(12) NOT NULL REFERENCES checklist_templates(template_id),
  original_assigned_to VARCHAR(12) NOT NULL REFERENCES users(user_id),
  current_assigned_to  VARCHAR(12) NOT NULL REFERENCES users(user_id),
  shift_id             VARCHAR(10) NOT NULL REFERENCES shifts(shift_id),
  frequency            VARCHAR(20) NOT NULL,
  due_date             DATE        NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'Pending',
  handover_date        DATE        NULL,
  is_auto_generated    BOOLEAN     NOT NULL DEFAULT TRUE,
  generated_by         VARCHAR(50) NOT NULL DEFAULT 'SCHEDULER',
  generated_at         TIMESTAMP   NOT NULL DEFAULT NOW(),
  started_at           TIMESTAMP   NULL,
  completed_at         TIMESTAMP   NULL,
  PRIMARY KEY (task_id)
);
