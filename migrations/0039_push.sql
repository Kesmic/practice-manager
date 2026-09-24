-- Push notifications, and the devices that receive them.
--
-- The portal's inbox already tells a member of staff everything that concerns them;
-- what it could not do was tell them while the portal was closed. A push subscription
-- is a device that has asked to be told: the browser's endpoint for it and the two
-- keys that let the Worker encrypt a message only that device can read. One row per
-- device, cascading with the account so that removing somebody removes their devices.

CREATE TABLE push_subscriptions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The push service's address for this device. Unique: the same device re-enrolling
  -- replaces its row rather than adding one.
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  -- Set when the push service refused a message for a reason other than the device
  -- being gone. A device that keeps failing is cleaned up by hand, not by a rule.
  failed_at    TEXT
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);

-- When a notification was handed to the push services. Null means not yet; the
-- dispatcher claims unpushed rows and sends them. Everything that already exists is
-- marked as pushed so that turning this on does not replay a year of inbox.
ALTER TABLE notifications ADD COLUMN pushed_at TEXT;
UPDATE notifications SET pushed_at = created_at WHERE pushed_at IS NULL;
