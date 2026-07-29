-- Shifts
CREATE TABLE IF NOT EXISTS shifts (
  shift_id   VARCHAR(10)  NOT NULL,
  shift_name VARCHAR(50)  NOT NULL UNIQUE,
  start_time TIME         NOT NULL,
  end_time   TIME         NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shift_id)
);

-- Users
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

-- Machines
CREATE TABLE IF NOT EXISTS machines (
  machine_id   VARCHAR(12)  NOT NULL,
  machine_name VARCHAR(100) NOT NULL,
  machine_code VARCHAR(30)  NOT NULL UNIQUE,
  dept_id      VARCHAR(10)  NOT NULL REFERENCES departments(dept_id),
  machine_type VARCHAR(50)  NULL,
  manufacturer VARCHAR(100) NULL,
  model_number VARCHAR(50)  NULL,
  serial_number VARCHAR(50) NULL,
  install_date DATE         NULL,
  location     VARCHAR(100) NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'Active',
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  created_by   VARCHAR(12)  NULL,
  PRIMARY KEY (machine_id)
);

-- Machine Assignments
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

-- Checklist Templates
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

-- Checklist Items
CREATE TABLE IF NOT EXISTS checklist_items (
  item_id          VARCHAR(12)  NOT NULL,
  template_id      VARCHAR(12)  NOT NULL REFERENCES checklist_templates(template_id),
  item_text        VARCHAR(500) NOT NULL,
  input_type       VARCHAR(20)  NOT NULL,
  is_mandatory     BOOLEAN      NOT NULL DEFAULT TRUE,
  dropdown_options TEXT         NULL,
  expected_value   VARCHAR(100) NULL,
  min_value        NUMERIC(10,2) NULL,
  max_value        NUMERIC(10,2) NULL,
  unit             VARCHAR(20)  NULL,
  sort_order       INTEGER      NOT NULL DEFAULT 0,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id)
);

-- Machine Template Map
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

-- Task Master
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

-- Task Responses
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

-- Task Verification
CREATE TABLE IF NOT EXISTS task_verification (
  verify_id   VARCHAR(12) NOT NULL,
  task_id     VARCHAR(12) NOT NULL UNIQUE REFERENCES task_master(task_id),
  verified_by VARCHAR(12) NOT NULL REFERENCES users(user_id),
  verified_at TIMESTAMP   NOT NULL DEFAULT NOW(),
  status      VARCHAR(20) NOT NULL,
  comments    TEXT        NULL,
  PRIMARY KEY (verify_id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  notif_id   VARCHAR(12)  NOT NULL,
  user_id    VARCHAR(12)  NOT NULL REFERENCES users(user_id),
  type       VARCHAR(30)  NOT NULL,
  title      VARCHAR(200) NOT NULL,
  message    TEXT         NOT NULL,
  is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
  channel    VARCHAR(20)  NOT NULL DEFAULT 'InApp',
  related_id VARCHAR(12)  NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
  read_at    TIMESTAMP    NULL,
  PRIMARY KEY (notif_id)
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id     VARCHAR(12) NOT NULL,
  user_id    VARCHAR(12) NULL,
  action     VARCHAR(20) NOT NULL,
  module     VARCHAR(50) NOT NULL,
  record_id  VARCHAR(12) NULL,
  old_value  JSONB       NULL,
  new_value  JSONB       NULL,
  ip_address VARCHAR(45) NULL,
  session_id VARCHAR(100) NULL,
  timestamp  TIMESTAMP   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (log_id)
);
