CREATE TABLE IF NOT EXISTS task_responses (
  response_id    VARCHAR(12)  NOT NULL,
  task_id        VARCHAR(12)  NOT NULL REFERENCES task_master(task_id),
  item_id        VARCHAR(12)  NOT NULL REFERENCES checklist_items(item_id),
  response_value TEXT         NULL,
  photo_url      VARCHAR(500) NULL,
  photo_drive_id VARCHAR(200) NULL,
  submitted_by   VARCHAR(12)  NOT NULL REFERENCES users(user_id),
  submitted_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  remarks        TEXT         NULL,
  PRIMARY KEY (response_id),
  UNIQUE (task_id, item_id)
);
