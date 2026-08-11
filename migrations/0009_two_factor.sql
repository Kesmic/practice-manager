-- Two-step sign-in.
--
-- Three tables rather than columns on `users`, because each has a different lifetime:
-- an enrolment lasts until it is reset, a recovery code lasts until it is spent, and a
-- half-finished sign-in lasts five minutes. Putting them together would mean pruning
-- one of them out of a row that has to survive.

-- The authenticator app enrolment. One per person.
CREATE TABLE IF NOT EXISTS user_totp (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- The shared secret. Encrypted with a key derived from PASSWORD_PEPPER where that is
  -- set, and stored as-is where it is not; the stored value carries its own prefix so
  -- both can be read. See worker/twofactor.ts.
  secret       TEXT NOT NULL,
  -- Null until the person has entered a code that verifies. An unconfirmed enrolment is
  -- not in force: it exists so a half-finished setup can be resumed rather than
  -- silently locking somebody out of an account they cannot produce a code for.
  confirmed_at TEXT,
  -- The last time step accepted, so a code cannot be used twice. Without this a code
  -- read over a shoulder stays good for the rest of its ninety-second window.
  last_counter INTEGER,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Single-use codes for the day the phone is lost.
CREATE TABLE IF NOT EXISTS recovery_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the normalised code, salted with the user id. The plain code is shown
  -- once, at enrolment, and is not recoverable afterwards: a code the firm could read
  -- out of its own database would be a password stored in clear text.
  code_hash  TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes (user_id, used_at);

-- A sign-in that has passed the password and not yet the second factor.
--
-- Deliberately not a session: nothing in the application accepts one of these as
-- authentication. It carries only the right to offer a code for one particular account,
-- for five minutes, five times.
CREATE TABLE IF NOT EXISTS login_challenges (
  -- SHA-256 of the challenge token. The token itself only ever exists in the response
  -- to the password step and in the next request, exactly like a session cookie.
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_challenges_expiry ON login_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_user ON login_challenges (user_id);
