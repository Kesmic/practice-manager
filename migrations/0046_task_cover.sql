-- What a deliverable is covered by: a line of the client's package, or a piece of
-- one-off work they asked for.
--
-- Until now a job could be linked to a signed engagement, which is a contract, not a
-- reason. The question a Partner actually asks of a job is "is this inside what they
-- pay every month, or is it something we quoted?" - and the answer is what decides
-- whether it is billed. So a job now points at a package line (the VAT return under
-- Starter) or at the client's own request (the tax health check they agreed to).
-- Both optional, both nulled rather than cascaded if the catalogue changes: the job
-- and its record outlive the menu.
ALTER TABLE tasks ADD COLUMN package_service_id TEXT REFERENCES package_services(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN client_service_id TEXT REFERENCES client_services(id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_package_service ON tasks (package_service_id);
CREATE INDEX idx_tasks_client_service ON tasks (client_service_id);
