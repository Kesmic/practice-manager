-- A package can be priced as a range: a starting price below the list price, and a
-- line saying who gets it.
--
-- Starter is meant for micro and small businesses, and a single list price scares off
-- the smallest of them before they read what it covers. A starting price lets the card
-- say "GHS 900 to 1,500 a month" with a word underneath about who pays the lower end.
-- It changes nothing about billing: what a client actually pays is set on their own
-- subscription, and can already be lower than the list price. This is a display and a
-- promise. Both columns are optional; blank means the card reads as it always did.
ALTER TABLE subscription_tiers ADD COLUMN fee_from REAL;
ALTER TABLE subscription_tiers ADD COLUMN fee_note TEXT;

-- A suggestion for Starter, to be changed in Portal settings: sixty percent of the
-- list price, to the nearest fifty, and the wording. Only where a list price exists and
-- nothing has been set yet.
UPDATE subscription_tiers
   SET fee_from = ROUND(monthly_fee * 0.6 / 50) * 50,
       fee_note = 'The lower end is for a handful of transactions a month and nobody on payroll. Ask us and we will quote your number.'
 WHERE tier = 'starter' AND monthly_fee IS NOT NULL AND fee_from IS NULL;
