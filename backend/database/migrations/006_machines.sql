CREATE TABLE IF NOT EXISTS machines (
  machine_id    VARCHAR(12)  NOT NULL,
  machine_name  VARCHAR(100) NOT NULL,
  machine_code  VARCHAR(30)  NOT NULL UNIQUE,
  dept_id       VARCHAR(10)  NOT NULL REFERENCES departments(dept_id),
  machine_type  VARCHAR(50)  NULL,
  manufacturer  VARCHAR(100) NULL,
  model_number  VARCHAR(50)  NULL,
  serial_number VARCHAR(50)  NULL,
  install_date  DATE         NULL,
  location      VARCHAR(100) NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'Active',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  created_by    VARCHAR(12)  NULL,
  PRIMARY KEY (machine_id)
);
