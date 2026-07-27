-- ============================================================
-- Migration 004: Shifts
-- ============================================================
CREATE TABLE IF NOT EXISTS shifts (
  shift_id      VARCHAR(10)   NOT NULL,
  shift_name    VARCHAR(50)   NOT NULL,
  start_time    TIME          NOT NULL,
  end_time      TIME          NOT NULL,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shift_id),
  UNIQUE KEY uq_shift_name (shift_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 005: Users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  user_id         VARCHAR(12)   NOT NULL,
  employee_code   VARCHAR(20)   NOT NULL,
  full_name       VARCHAR(100)  NOT NULL,
  username        VARCHAR(50)   NOT NULL,
  password_hash   VARCHAR(255)  NOT NULL,
  role_id         VARCHAR(10)   NOT NULL,
  dept_id         VARCHAR(10)   NOT NULL,
  shift_id        VARCHAR(10)   NOT NULL,
  phone           VARCHAR(15)   NULL,
  email           VARCHAR(100)  NULL,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  last_login      DATETIME      NULL,
  created_at      DATETIME      NOT NULL DEFAULT NOW(),
  updated_at      DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  created_by      VARCHAR(12)   NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_username (username),
  UNIQUE KEY uq_employee_code (employee_code),
  INDEX idx_role_id (role_id),
  INDEX idx_dept_id (dept_id),
  INDEX idx_shift_id (shift_id),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(role_id),
  CONSTRAINT fk_users_dept FOREIGN KEY (dept_id) REFERENCES departments(dept_id),
  CONSTRAINT fk_users_shift FOREIGN KEY (shift_id) REFERENCES shifts(shift_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 006: Machines
-- ============================================================
CREATE TABLE IF NOT EXISTS machines (
  machine_id      VARCHAR(12)   NOT NULL,
  machine_name    VARCHAR(100)  NOT NULL,
  machine_code    VARCHAR(30)   NOT NULL,
  dept_id         VARCHAR(10)   NOT NULL,
  machine_type    VARCHAR(50)   NULL,
  manufacturer    VARCHAR(100)  NULL,
  model_number    VARCHAR(50)   NULL,
  serial_number   VARCHAR(50)   NULL,
  install_date    DATE          NULL,
  location        VARCHAR(100)  NULL,
  status          ENUM('Active','Under Maintenance','Inactive') NOT NULL DEFAULT 'Active',
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME      NOT NULL DEFAULT NOW(),
  updated_at      DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  created_by      VARCHAR(12)   NULL,
  PRIMARY KEY (machine_id),
  UNIQUE KEY uq_machine_code (machine_code),
  INDEX idx_dept_id (dept_id),
  INDEX idx_status (status),
  CONSTRAINT fk_machines_dept FOREIGN KEY (dept_id) REFERENCES departments(dept_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 007: Machine Assignments (Operator Handover History)
-- ============================================================
CREATE TABLE IF NOT EXISTS machine_assignments (
  assign_id         VARCHAR(12)   NOT NULL,
  machine_id        VARCHAR(12)   NOT NULL,
  user_id           VARCHAR(12)   NOT NULL,
  assigned_date     DATE          NOT NULL,
  unassigned_date   DATE          NULL,
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  assigned_by       VARCHAR(12)   NULL,
  handover_notes    TEXT          NULL,
  created_at        DATETIME      NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assign_id),
  INDEX idx_machine_id (machine_id),
  INDEX idx_user_id (user_id),
  INDEX idx_is_active (is_active),
  CONSTRAINT fk_ma_machine FOREIGN KEY (machine_id) REFERENCES machines(machine_id),
  CONSTRAINT fk_ma_user FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 008: Checklist Templates
-- ============================================================
CREATE TABLE IF NOT EXISTS checklist_templates (
  template_id     VARCHAR(12)   NOT NULL,
  template_name   VARCHAR(150)  NOT NULL,
  dept_id         VARCHAR(10)   NOT NULL,
  frequency       ENUM('Daily','10-Day','15-Day','Weekly','Monthly','Quarterly','Half-Yearly','Yearly','On-Demand') NOT NULL,
  has_photo       TINYINT(1)    NOT NULL DEFAULT 0,
  description     TEXT          NULL,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME      NOT NULL DEFAULT NOW(),
  updated_at      DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  created_by      VARCHAR(12)   NULL,
  PRIMARY KEY (template_id),
  INDEX idx_dept_id (dept_id),
  INDEX idx_frequency (frequency),
  CONSTRAINT fk_ct_dept FOREIGN KEY (dept_id) REFERENCES departments(dept_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 009: Checklist Items
-- ============================================================
CREATE TABLE IF NOT EXISTS checklist_items (
  item_id           VARCHAR(12)   NOT NULL,
  template_id       VARCHAR(12)   NOT NULL,
  item_text         VARCHAR(500)  NOT NULL,
  input_type        ENUM('Checkbox','PassFail','YesNo','Dropdown','Text','Number','Decimal','Temperature','Pressure','Date','Time','Photo','Remarks') NOT NULL,
  is_mandatory      TINYINT(1)    NOT NULL DEFAULT 1,
  dropdown_options  TEXT          NULL,
  expected_value    VARCHAR(100)  NULL,
  min_value         DECIMAL(10,2) NULL,
  max_value         DECIMAL(10,2) NULL,
  unit              VARCHAR(20)   NULL,
  sort_order        INT           NOT NULL DEFAULT 0,
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  created_at        DATETIME      NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id),
  INDEX idx_template_id (template_id),
  INDEX idx_sort_order (sort_order),
  CONSTRAINT fk_ci_template FOREIGN KEY (template_id) REFERENCES checklist_templates(template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 010: Machine Template Map (with Schedule Config)
-- ============================================================
CREATE TABLE IF NOT EXISTS machine_template_map (
  map_id                VARCHAR(12)   NOT NULL,
  machine_id            VARCHAR(12)   NOT NULL,
  template_id           VARCHAR(12)   NOT NULL,
  is_active             TINYINT(1)    NOT NULL DEFAULT 1,
  schedule_start_date   DATE          NOT NULL,
  schedule_day          TINYINT       NULL COMMENT '1=Mon..7=Sun for Weekly; day of month for Monthly',
  last_generated_date   DATE          NULL,
  assigned_by           VARCHAR(12)   NULL,
  assigned_date         DATETIME      NOT NULL DEFAULT NOW(),
  updated_at            DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  PRIMARY KEY (map_id),
  UNIQUE KEY uq_machine_template (machine_id, template_id),
  INDEX idx_machine_id (machine_id),
  INDEX idx_template_id (template_id),
  INDEX idx_is_active (is_active),
  CONSTRAINT fk_mtm_machine FOREIGN KEY (machine_id) REFERENCES machines(machine_id),
  CONSTRAINT fk_mtm_template FOREIGN KEY (template_id) REFERENCES checklist_templates(template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 011: Task Master (Heart of the system)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_master (
  task_id               VARCHAR(12)   NOT NULL,
  machine_id            VARCHAR(12)   NOT NULL,
  template_id           VARCHAR(12)   NOT NULL,
  original_assigned_to  VARCHAR(12)   NOT NULL COMMENT 'Who was assigned when task was created',
  current_assigned_to   VARCHAR(12)   NOT NULL COMMENT 'Current operator (changes on handover)',
  shift_id              VARCHAR(10)   NOT NULL,
  frequency             ENUM('Daily','10-Day','15-Day','Weekly','Monthly','Quarterly','Half-Yearly','Yearly','On-Demand') NOT NULL,
  due_date              DATE          NOT NULL,
  status                ENUM('Pending','In Progress','Completed','Verified','Overdue','Skipped','Rejected') NOT NULL DEFAULT 'Pending',
  handover_date         DATE          NULL COMMENT 'Date when operator changed mid-task',
  is_auto_generated     TINYINT(1)    NOT NULL DEFAULT 1,
  generated_by          VARCHAR(50)   NOT NULL DEFAULT 'SCHEDULER' COMMENT 'SCHEDULER or UserID',
  generated_at          DATETIME      NOT NULL DEFAULT NOW(),
  started_at            DATETIME      NULL,
  completed_at          DATETIME      NULL,
  PRIMARY KEY (task_id),
  INDEX idx_machine_id (machine_id),
  INDEX idx_template_id (template_id),
  INDEX idx_current_assigned (current_assigned_to),
  INDEX idx_original_assigned (original_assigned_to),
  INDEX idx_due_date (due_date),
  INDEX idx_status (status),
  INDEX idx_frequency (frequency),
  INDEX idx_due_status (due_date, status),
  CONSTRAINT fk_tm_machine FOREIGN KEY (machine_id) REFERENCES machines(machine_id),
  CONSTRAINT fk_tm_template FOREIGN KEY (template_id) REFERENCES checklist_templates(template_id),
  CONSTRAINT fk_tm_original_user FOREIGN KEY (original_assigned_to) REFERENCES users(user_id),
  CONSTRAINT fk_tm_current_user FOREIGN KEY (current_assigned_to) REFERENCES users(user_id),
  CONSTRAINT fk_tm_shift FOREIGN KEY (shift_id) REFERENCES shifts(shift_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 012: Task Responses
-- ============================================================
CREATE TABLE IF NOT EXISTS task_responses (
  response_id     VARCHAR(12)   NOT NULL,
  task_id         VARCHAR(12)   NOT NULL,
  item_id         VARCHAR(12)   NOT NULL,
  response_value  TEXT          NULL,
  photo_url       VARCHAR(500)  NULL COMMENT 'Google Drive file URL',
  photo_drive_id  VARCHAR(200)  NULL COMMENT 'Google Drive file ID for deletion',
  submitted_by    VARCHAR(12)   NOT NULL,
  submitted_at    DATETIME      NOT NULL DEFAULT NOW(),
  remarks         TEXT          NULL,
  PRIMARY KEY (response_id),
  UNIQUE KEY uq_task_item (task_id, item_id),
  INDEX idx_task_id (task_id),
  INDEX idx_item_id (item_id),
  INDEX idx_submitted_by (submitted_by),
  CONSTRAINT fk_tr_task FOREIGN KEY (task_id) REFERENCES task_master(task_id),
  CONSTRAINT fk_tr_item FOREIGN KEY (item_id) REFERENCES checklist_items(item_id),
  CONSTRAINT fk_tr_user FOREIGN KEY (submitted_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 013: Task Verification
-- ============================================================
CREATE TABLE IF NOT EXISTS task_verification (
  verify_id     VARCHAR(12)   NOT NULL,
  task_id       VARCHAR(12)   NOT NULL,
  verified_by   VARCHAR(12)   NOT NULL,
  verified_at   DATETIME      NOT NULL DEFAULT NOW(),
  status        ENUM('Approved','Rejected','Needs Correction') NOT NULL,
  comments      TEXT          NULL,
  PRIMARY KEY (verify_id),
  UNIQUE KEY uq_task_verification (task_id),
  INDEX idx_task_id (task_id),
  INDEX idx_verified_by (verified_by),
  CONSTRAINT fk_tv_task FOREIGN KEY (task_id) REFERENCES task_master(task_id),
  CONSTRAINT fk_tv_user FOREIGN KEY (verified_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 014: Notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  notif_id      VARCHAR(12)   NOT NULL,
  user_id       VARCHAR(12)   NOT NULL,
  type          ENUM('Task_Due','Task_Overdue','Verification_Needed','Task_Rejected','Handover','System') NOT NULL,
  title         VARCHAR(200)  NOT NULL,
  message       TEXT          NOT NULL,
  is_read       TINYINT(1)    NOT NULL DEFAULT 0,
  channel       ENUM('InApp','Email','GChat','All') NOT NULL DEFAULT 'InApp',
  related_id    VARCHAR(12)   NULL COMMENT 'TaskID or MachineID for deep linking',
  created_at    DATETIME      NOT NULL DEFAULT NOW(),
  read_at       DATETIME      NULL,
  PRIMARY KEY (notif_id),
  INDEX idx_user_id (user_id),
  INDEX idx_is_read (is_read),
  INDEX idx_type (type),
  INDEX idx_created_at (created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Migration 015: Audit Logs (Write-only — never updated)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id        VARCHAR(12)   NOT NULL,
  user_id       VARCHAR(12)   NULL COMMENT 'NULL for system actions',
  action        ENUM('CREATE','UPDATE','DELETE','LOGIN','LOGOUT','VERIFY','ASSIGN','HANDOVER','GENERATE') NOT NULL,
  module        VARCHAR(50)   NOT NULL,
  record_id     VARCHAR(12)   NULL,
  old_value     JSON          NULL,
  new_value     JSON          NULL,
  ip_address    VARCHAR(45)   NULL,
  session_id    VARCHAR(100)  NULL,
  timestamp     DATETIME      NOT NULL DEFAULT NOW(),
  PRIMARY KEY (log_id),
  INDEX idx_user_id (user_id),
  INDEX idx_module (module),
  INDEX idx_action (action),
  INDEX idx_record_id (record_id),
  INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
