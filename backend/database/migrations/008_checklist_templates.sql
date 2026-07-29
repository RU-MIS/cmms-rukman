CREATE TABLE IF NOT EXISTS checklist_templates (
  template_id   VARCHAR(12)  NOT NULL,
  template_name VARCHAR(150) NOT NULL,
  dept_id       VARCHAR(10)  NOT NULL REFERENCES departments(dept_id),
  frequency     VARCHAR(20)  NOT NULL,
  has_photo     BOOLEAN      NOT NULL DEFAULT FALSE,
  description   TEXT         NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  created_by    VARCHAR(12)  NULL,
  PRIMARY KEY (template_id)
);
