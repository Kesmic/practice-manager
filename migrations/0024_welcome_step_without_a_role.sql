-- Take the role out of the welcome step on checklists already created.
--
-- The step used to read "Read the welcome message from the Managing Director". That
-- title is the firm's own setting, editable under Portal settings, and this firm's is
-- "Founding Partner" - so a checklist created before the change contradicted the letter
-- printed directly above it, which is signed from the setting.
--
-- Programmes created from now on carry the shorter label, so this is only for the rows
-- already written. Matched on the exact old text: a step somebody edited by hand, or one
-- added individually, says what its author meant and is left alone.
--
-- Nothing else on the row is touched - not whether it is done, not who owns it, not its
-- due date - so a person part-way through their onboarding sees the wording change and
-- nothing else.
UPDATE onboarding_items
   SET label = 'Read the welcome message'
 WHERE label = 'Read the welcome message from the Managing Director';
