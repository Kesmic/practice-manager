-- Completing a contract from what the firm already knows.
--
-- Both templates are written with bracketed placeholders. Until now somebody found and
-- replaced all thirty-eight of them by hand after copying a template, per person, in a
-- fifteen-page instrument. What happens in practice is that two or three are missed and
-- somebody signs a contract saying their notice period is [NOTICE DAYS] days.
--
-- This migration adds the two places a value can be stored, and repairs three
-- placeholders in the employment template that no substitution could have reached.

-- ---------------------------------------------------------------------------
-- Per-person values
-- ---------------------------------------------------------------------------
--
-- Only for the placeholders that genuinely differ per person and have no home in the
-- employment record. Anything already in the record - name, job title, start date,
-- salary, address, TIN - is read from there rather than copied here, because two copies
-- of a fact are how a contract comes to disagree with the personnel file.
--
-- A row may also override a firm-wide default, for the case where one Associate's terms
-- were negotiated: the resolver prefers a per-person value where one exists.
CREATE TABLE IF NOT EXISTS contract_details (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The placeholder text without its brackets, exactly as it appears in the template.
  token       TEXT NOT NULL,
  value       TEXT NOT NULL,
  supplied_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  supplied_at TEXT NOT NULL,
  PRIMARY KEY (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_contract_details_user
  ON contract_details (user_id);

-- ---------------------------------------------------------------------------
-- Firm-wide values
-- ---------------------------------------------------------------------------
--
-- The standard terms - the registered company name, the notice period, the payment
-- days, the fee for each tier - are the same in every contract the firm issues, so they
-- are set once rather than retyped per person. Held in settings as JSON, alongside the
-- other firm-wide values that have their own validating endpoint.
--
-- Seeded empty. The field registry in shared/contract-fields.ts carries a starting
-- value for the terms that have a conventional one, so an unset firm still issues a
-- coherent contract rather than one full of brackets, and the values it cannot guess -
-- the company number, the registered address - stay visibly outstanding.
INSERT INTO settings (key, value, updated_at)
  VALUES ('contract_defaults', '', datetime('now'))
  ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Three placeholders in the employment template that could never be filled
-- ---------------------------------------------------------------------------

-- [DAYS] appeared twice with two different meanings - the days of the working week in
-- clause 4, and the annual leave entitlement in clause 6. One token cannot hold both,
-- and whichever value was substituted, one of the two clauses would have been wrong.
UPDATE documents
   SET body = replace(body,
         'Normal working hours are [HOURS] per week, [DAYS].',
         'Normal working hours are [HOURS] per week, [WORKING DAYS].'),
       updated_at = datetime('now')
 WHERE id = 'tpl_contract';

UPDATE documents
   SET body = replace(body,
         '[DAYS] working days paid annual leave',
         '[LEAVE DAYS] working days paid annual leave'),
       updated_at = datetime('now')
 WHERE id = 'tpl_contract';

-- [PROBATION NOTICE] was wrapped across a line break, so the text held "[PROBATION" and
-- "NOTICE]" on separate lines. Nothing scanning for a placeholder would find it, and
-- nobody proofreading would see anything wrong.
UPDATE documents
   SET body = replace(body,
         'terminate on [PROBATION' || char(10) || 'NOTICE] notice.',
         'terminate on [PROBATION NOTICE] notice.'),
       updated_at = datetime('now')
 WHERE id = 'tpl_contract';
