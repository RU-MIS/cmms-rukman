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
