CREATE TABLE IF NOT EXISTS shifts (
  shift_id   VARCHAR(10)  NOT NULL,
  shift_name VARCHAR(50)  NOT NULL UNIQUE,
  start_time TIME         NOT NULL,
  end_time   TIME         NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shift_id)
);
