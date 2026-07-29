CREATE TABLE IF NOT EXISTS checklist_items (
  item_id          VARCHAR(12)   NOT NULL,
  template_id      VARCHAR(12)   NOT NULL REFERENCES checklist_templates(template_id),
  item_text        VARCHAR(500)  NOT NULL,
  input_type       VARCHAR(20)   NOT NULL,
  is_mandatory     BOOLEAN       NOT NULL DEFAULT TRUE,
  dropdown_options TEXT          NULL,
  expected_value   VARCHAR(100)  NULL,
  min_value        NUMERIC(10,2) NULL,
  max_value        NUMERIC(10,2) NULL,
  unit             VARCHAR(20)   NULL,
  sort_order       INTEGER       NOT NULL DEFAULT 0,
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id)
);
