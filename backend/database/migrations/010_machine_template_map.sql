CREATE TABLE IF NOT EXISTS machine_template_map (
  map_id              VARCHAR(12) NOT NULL,
  machine_id          VARCHAR(12) NOT NULL REFERENCES machines(machine_id),
  template_id         VARCHAR(12) NOT NULL REFERENCES checklist_templates(template_id),
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  schedule_start_date DATE        NOT NULL,
  schedule_day        SMALLINT    NULL,
  last_generated_date DATE        NULL,
  assigned_by         VARCHAR(12) NULL,
  assigned_date       TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (map_id),
  UNIQUE (machine_id, template_id)
);
