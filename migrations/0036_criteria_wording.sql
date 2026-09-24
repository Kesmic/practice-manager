-- Two criteria explained to the client in the client's own words.
--
-- The line under a criterion on "Where you sit against this package" is read by the
-- client on their own page, and "from the client's own management accounts" is the firm
-- talking about them in the third person. It now says "your". The sentence about
-- dollars and the pricing proposal goes: the ceiling already shows its currency, and the
-- reason the bands are in dollars is the firm's business, not the client's.
--
-- Only where the wording is still the seeded one. A firm that has already rewritten a
-- criterion in Portal settings keeps its own words.

UPDATE subscription_criteria
   SET how_measured = 'Averaged over three months, from your own management accounts.'
 WHERE id = 'crit_monthly_turnover'
   AND how_measured = 'Averaged over three months, from the client''s own management accounts. In dollars, because the firm''s pricing proposal sets the bands that way.';

UPDATE subscription_criteria
   SET how_measured = 'Averaged over three months, from your own bank and cash books.'
 WHERE id = 'crit_transactions'
   AND how_measured = 'Averaged over three months, from the client''s bank and cash books.';
