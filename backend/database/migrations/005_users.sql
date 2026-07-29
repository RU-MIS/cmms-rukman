CREATE TABLE IF NOT EXISTS users (
  user_id       VARCHAR(12)  NOT NULL,
  employee_code VARCHAR(20)  NOT NULL UNIQUE,
  full_name     VARCHAR(100) NOT NULL,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_id       VARCHAR(10)  NOT NULL REFERENCES roles(role_id),
  dept_id       VARCHAR(10)  NOT NULL REFERENCES departments(dept_id),
  shift_id      VARCHAR(10)  NOT NULL REFERENCES shifts(shift_id),
  phone         VARCHAR(15)  NULL,
  email         VARCHAR(100) NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login    TIMESTAMP    NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  created_by    VARCHAR(12)  NULL,
  PRIMARY KEY (user_id)
);
