-- The work email address a member of staff has been given.
--
-- The portal does not create mailboxes - shared/staff-email.ts argues for why, briefly
-- that holding a credential able to administer the firm's email is a poor trade against
-- a minute of an administrator's time per joiner, and that it would tie the portal to
-- one host's API. The mailbox is created in the host's own admin centre; these columns
-- record what was given out and when.
--
-- What is deliberately NOT here is the mailbox password. The administrator types it in,
-- the portal puts it in one message to the person and shows it once on screen, and then
-- it is gone. A temporary password the portal kept would be a password the portal could
-- leak, and nothing in the portal ever needs to read it again.
ALTER TABLE employee_profiles ADD COLUMN work_email TEXT;

-- Which host it was issued against, kept per person rather than read from the firm's
-- current setting. A firm that moves from one host to another should still be able to
-- see where somebody's mailbox was made, and when.
ALTER TABLE employee_profiles ADD COLUMN work_email_host TEXT;

-- When the details were last handed over, and to where. The address is kept because it
-- is the answer to "did this actually reach them" - a personal address that has since
-- changed still tells you what happened at the time.
ALTER TABLE employee_profiles ADD COLUMN work_email_issued_at TEXT;
ALTER TABLE employee_profiles ADD COLUMN work_email_issued_to TEXT;

-- One address per person, and no two people sharing one.
--
-- Partial, so the many people without a work email do not all collide on NULL. This is
-- the check that matters: two members of staff issued the same mailbox is not a tidiness
-- problem, it is two people reading each other's post.
CREATE UNIQUE INDEX idx_profiles_work_email
  ON employee_profiles (work_email) WHERE work_email IS NOT NULL;
