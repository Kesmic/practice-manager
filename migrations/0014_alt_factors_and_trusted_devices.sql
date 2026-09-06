-- Two additions to how the second step works: another way to satisfy it, and a way to
-- be asked for it less often.
--
-- Both tables are empty after this migration and both features are inert until somebody
-- acts. Nobody's sign-in changes on deploy.

-- ---------------------------------------------------------------------------
-- Security questions
-- ---------------------------------------------------------------------------
--
-- A weaker factor than an authenticator app, which is why `shared/security-questions.ts`
-- carries the argument and why the firm has to switch it on deliberately. What matters
-- here is how the answers are stored.
--
-- A security answer is low-entropy in a way a recovery code is not: "what was your first
-- car" has maybe a few thousand plausible values, so a plain digest of it in a leaked
-- database is a dictionary attack that finishes in seconds. So the digest is keyed with
-- a secret that is not in the database - the same PASSWORD_PEPPER used for passwords and
-- for sealing TOTP secrets, through HKDF with its own label so the three uses stay
-- cryptographically separate. Where no pepper is set the answer falls back to a digest
-- salted with the user id, and `answer_scheme` records which it was, so a deployment can
-- tell the two apart and the account screen can say so plainly.
CREATE TABLE IF NOT EXISTS user_security_questions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Shown back to the person at sign-in, so stored as written rather than as an id into
  -- a fixed list: the suggested questions are a starting point and anyone may write
  -- their own.
  question    TEXT NOT NULL,
  -- Digest of the normalised answer. See normaliseAnswer() - what is hashed is the
  -- answer with case, accents, punctuation and repeated spaces removed, so that
  -- "St. Mary's" still matches "st marys" eighteen months later.
  answer_hash TEXT NOT NULL,
  -- 'hmac' where a pepper keyed the digest, 'salted' where none was set.
  answer_scheme TEXT NOT NULL DEFAULT 'salted'
                  CHECK (answer_scheme IN ('hmac','salted')),
  -- The order they are asked in, which is the order they were entered.
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_questions_user
  ON user_security_questions (user_id, position);

-- ---------------------------------------------------------------------------
-- Remembered devices
-- ---------------------------------------------------------------------------
--
-- The row's id is the SHA-256 of the token in the browser's cookie, exactly like
-- `sessions`: the token itself is never stored, so a database leak does not hand over a
-- set of devices that skip the second step.
--
-- `user_id` is not decoration. A remembered device means "this browser, trusted by this
-- person", and every lookup matches on both - otherwise a machine trusted by one
-- colleague would skip the second step for another who signs in on it afterwards.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- "Chrome on Mac", derived from the user agent. A label to recognise a row by, not
  -- evidence of anything: a user agent is a claim the browser makes about itself.
  label        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

-- The account screen's list, and the expiry sweep.
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_expiry ON trusted_devices (expires_at);
