-- Per-person control over email notifications.
--
-- Defaults to on, because someone assigned work should hear about it, and the
-- in-app inbox alone relies on them remembering to look. Turning it off never
-- affects the inbox: that stays the system of record either way.
ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1;
