-- Who owes a status report, decided per person.
--
-- The firm-wide schedule says when reports are due. This says who owes them, which is
-- the firm's to decide person by person: a Partner who carries no deliverables but runs
-- three engagements may well owe one, and somebody on a fixed routine may not.
--
-- Null means nobody has decided, and the rule that was already in force applies - owed
-- while they are carrying live client work. Stored as absence rather than the word
-- 'automatic' so that a person nobody has thought about carries no setting instead of a
-- decision they were never part of, and so the default can change later without
-- rewriting every row.
ALTER TABLE employee_profiles ADD COLUMN status_reports TEXT
  CHECK (status_reports IN ('always', 'never'));
