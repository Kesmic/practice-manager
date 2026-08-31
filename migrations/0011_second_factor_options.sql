-- Two ways past the daily code: a device the person has already proved once, and a pair
-- of secret questions for when the phone is not to hand.

-- ---------------------------------------------------------------------------
-- Remembered devices
-- ---------------------------------------------------------------------------
--
-- One row per browser that has completed the second step and asked to be remembered.
-- `id` is the SHA-256 of the token in the cookie, never the token, so a database export
-- cannot be replayed as a device. That is the same rule the sessions table follows.
--
-- `user_id` is on the row rather than implied, and is checked on every use: a token
-- lifted from one account must not open another.
CREATE TABLE trusted_devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  user_agent   TEXT
);

CREATE INDEX idx_trusted_devices_user ON trusted_devices (user_id, expires_at);

-- ---------------------------------------------------------------------------
-- Secret questions
-- ---------------------------------------------------------------------------
--
-- The question is stored as written, because it has to be shown back at sign-in. The
-- answer is never stored: what is kept is a SHA-256 of the normalised answer salted with
-- the user id, exactly as recovery codes are handled, so the hashes are not portable
-- between accounts and a stolen table is not a list of answers.
--
-- `position` keeps the pair in the order they were set, so somebody is asked their
-- questions in the order they wrote them rather than whatever order the database returns.
CREATE TABLE secret_questions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  question    TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_secret_questions_slot ON secret_questions (user_id, position);
