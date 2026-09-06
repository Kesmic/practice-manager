-- Failed sign-ins, so a password cannot be guessed indefinitely.
--
-- The portal already limits the two-step code and the public intake forms. The password
-- step had no limit at all, which left the one credential every account has as the only
-- unguarded door - and the PBKDF2 work factor is trimmed to fit the Free plan's CPU
-- budget, so the hash is not slow enough to be a limit by itself. See
-- shared/login-policy.ts for the reasoning and the numbers.
--
-- A row per failure rather than a counter per account. Counting rows in a window means
-- a lockout expires by itself, with nothing to reset and no administrator in the loop,
-- and it lets one table answer both questions asked of it: how often this account has
-- been tried, and how often this source has tried anything.
--
-- Nothing identifying is stored. Both keys are SHA-256 digests, so this table cannot be
-- read back into a list of who failed to sign in and from where. It is a rate counter,
-- not a log; `hr_events` and `task_events` are where the portal keeps records meant to be
-- read.
CREATE TABLE IF NOT EXISTS login_attempts (
  id          TEXT PRIMARY KEY,
  -- SHA-256 of the lower-cased email that was tried. Recorded whether or not the address
  -- belongs to anybody: refusing to count attempts against unknown addresses would let an
  -- attacker probe for which addresses exist by watching where the limit bites.
  account_key TEXT NOT NULL,
  -- SHA-256 of the source address. "local" where CF-Connecting-IP is absent, which is the
  -- case in `wrangler dev` and nowhere else.
  source_key  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- One index per counter. Both queries are a range scan on created_at within one key.
CREATE INDEX IF NOT EXISTS idx_login_attempts_account ON login_attempts (account_key, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_source  ON login_attempts (source_key, created_at);
