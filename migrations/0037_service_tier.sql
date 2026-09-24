-- The level a client is served at, where it is not the package they are billed for.
--
-- Some clients on Starter are given Growth's service - a goodwill arrangement, a
-- client being grown into the next package, a deal a Partner struck. Until now the
-- portal had one word for what a client is on, and it was the one on the invoice, so
-- the client's own page measured them against Starter's ceilings and told them nothing
-- about what they were actually getting.
--
-- Null means "the same as the package", which is nearly everybody. The package (`tier`)
-- stays what they are billed at and what Schedule 2 prices an associate's fee by; this
-- is what their figures are measured against and what their page says they receive.

ALTER TABLE client_subscriptions ADD COLUMN service_tier TEXT REFERENCES subscription_tiers(tier);
