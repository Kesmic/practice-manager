-- Allocating a client to somebody, and their right to decline it.
--
-- The Associate Consultant Agreement is built around the Assigned Client: the fee is
-- per assigned client per month, the onboarding obligations are per assigned client,
-- and Schedule 3 lists the clients assigned at the commencement date. The system had no
-- such concept - a client had a partner and a manager and that was all - so the central
-- unit of the agreement existed only on paper.
--
-- It also had no way to satisfy clause 8.2, which is what this table is for:
--
--   The Associate may decline the allocation of a further client where acceptance
--   would, in the Associate's reasonable professional judgement, prejudice the proper
--   performance of the Services in respect of an existing Assigned Client. A refusal on
--   that ground shall not constitute a breach of this Agreement.
--
-- A contractual right that can only be exercised by email is a right in name.

CREATE TABLE IF NOT EXISTS client_allocations (
  id        TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Which tier the client is on, which is what decides the fee under Schedule 2.
  -- Nullable: a client allocated to an employee is not priced this way.
  tier      TEXT CHECK (tier IN ('starter','growth','enterprise')),

  -- An allocation is an OFFER until it is answered. Setting a column outright would
  -- leave nothing to decline, and clause 8.2 would have nothing to operate on.
  status    TEXT NOT NULL DEFAULT 'offered'
              CHECK (status IN ('offered','accepted','declined','withdrawn','ended')),

  offered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  offered_at TEXT NOT NULL,
  note       TEXT,

  responded_at   TEXT,
  -- Which ground was relied on, by name rather than inferred from free text. This is
  -- the operative half of clause 8.2: a refusal recorded as a bare "declined", in a
  -- system that cannot tell the grounds apart, is evidence against somebody exercising
  -- a right their agreement gave them.
  decline_ground TEXT CHECK (decline_ground IN ('capacity','conflict','other')),
  decline_reason TEXT,

  -- Set when the firm reallocates the client away, which starts the handover period
  -- the agreement requires.
  ended_at TEXT,
  ended_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  ended_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_allocations_user
  ON client_allocations (user_id, status);

CREATE INDEX IF NOT EXISTS idx_client_allocations_client
  ON client_allocations (client_id, status);

-- One live allocation of a client to a person at a time.
--
-- Partial, so that the history survives: somebody who declined a client in March and is
-- offered it again in September has two rows, and both are worth keeping - the first is
-- the evidence that a right was exercised, the second that it was not held against
-- them. Only one of them may be live.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_allocations_live
  ON client_allocations (client_id, user_id)
  WHERE status IN ('offered', 'accepted');
