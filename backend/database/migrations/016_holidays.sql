CREATE TABLE IF NOT EXISTS holidays (
  holiday_id   VARCHAR(12)  NOT NULL,
  holiday_name VARCHAR(100) NOT NULL,
  holiday_date DATE         NOT NULL UNIQUE,
  holiday_type VARCHAR(20)  NOT NULL DEFAULT 'National',
  is_recurring BOOLEAN      NOT NULL DEFAULT FALSE,
  description  TEXT         NULL,
  created_by   VARCHAR(12)  NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (holiday_id)
);
