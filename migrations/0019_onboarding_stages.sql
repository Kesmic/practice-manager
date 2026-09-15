-- Stages and dates on the onboarding programme, and the details a first sign-in collects.
--
-- Two changes, both additive.
--
-- ## Stages
--
-- The programme was a flat list of steps. A new joiner could see what was coming but not
-- when any of it was due, and the firm could not tell whether somebody was behind. Each
-- item now carries the stage it belongs to and the date it falls due, computed from the
-- person's start date when the programme is created. See shared/onboarding.ts.
--
-- Both columns are nullable, and existing rows keep NULL. A programme created before this
-- migration therefore shows as it always did - an unstaged list - rather than being
-- retrospectively assigned to stages nobody chose for it.
ALTER TABLE onboarding_items ADD COLUMN stage TEXT;
ALTER TABLE onboarding_items ADD COLUMN due_date TEXT;

CREATE INDEX IF NOT EXISTS idx_onboarding_stage
  ON onboarding_items (user_id, stage, position);

-- ## Identification, collected from the person
--
-- The programme has always asked new joiners to "provide identification and right-to-work
-- documents", and there was nowhere for them to put it - the step could only be ticked by
-- somebody who had received it another way. These are the fields the first sign-in now
-- asks for.
--
-- They sit in `employee_profiles` alongside the rest of the personal details, which means
-- they inherit that table's access rule: visible to the person themselves and to HR
-- administrators, and NOT to a line manager. An identity document number is exactly the
-- kind of thing a reporting line has no business seeing.
--
-- The document itself is a link, like every other document in this system. The portal
-- stores no files and fetches no link.
ALTER TABLE employee_profiles ADD COLUMN id_type TEXT;
ALTER TABLE employee_profiles ADD COLUMN id_number TEXT;
ALTER TABLE employee_profiles ADD COLUMN id_document_url TEXT;
ALTER TABLE employee_profiles ADD COLUMN right_to_work_note TEXT;
ALTER TABLE employee_profiles ADD COLUMN qualification_document_url TEXT;

-- Tax identification. Needed for payroll on an employee and for withholding tax on an
-- Associate Consultant, so it is asked of everybody rather than being one of the few
-- things that differ between the two programmes.
ALTER TABLE employee_profiles ADD COLUMN tin TEXT;
