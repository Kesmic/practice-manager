-- The Client requests area is retired: the two public enquiry links, the queue they
-- fed, and the service list those forms offered.
--
-- The links' tokens and the service list are removed, so an old link can never be
-- brought back to life by a later change - it now reaches nothing. The enquiries
-- already received (client_requests) are kept: they are records of what people asked,
-- with contact details the firm is responsible for, and they stay erasable through
-- Data retention like everything else.
DELETE FROM settings WHERE key IN ('intake_token_new', 'intake_token_existing', 'intake_services');
