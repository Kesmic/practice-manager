-- Give every session that already exists a fresh idle clock.
--
-- `last_seen_at` has been on the sessions table since the first migration, but until the
-- inactivity timeout arrived nothing ever wrote to it after the row was created. So on
-- every live session it holds the moment somebody signed in, which for anyone signed in
-- for a few days is far outside any idle window the firm might pick.
--
-- Without this, the deploy that turns the timeout on signs out every single person at the
-- firm the instant it lands. That is a mild outage rather than a serious one, since the
-- fix is to sign in again, but it is caused entirely by a column that was stale for
-- reasons that had nothing to do with the person holding the session. The same shape of
-- problem as a policy that switches itself on during a migration, and avoided the same
-- way: start everyone's clock at the deploy rather than at whenever they last signed in.
--
-- The format matches what the Worker writes with `toISOString()`, so the two are read back
-- by the same `new Date(...)` without a special case.
--
-- Expiry is untouched. A session already past `expires_at` is still refused.
UPDATE sessions
   SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE last_seen_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
