-- An image of somebody's actual signature, and the one used on each signed document.
--
-- shared/signatures.ts argues for why this exists when the typed-name record was
-- already sound: the evidence was good, but the file the firm hands to a bank did not
-- look signed. The bytes live in R2; this table is the index.
--
-- The table is append-only by design. Uploading a new signature adds a row and leaves
-- every earlier one alone, because a contract signed last year has to go on showing
-- the signature that was used last year. `document_signatures.signature_id` points at
-- the specimen that was current at the moment of signing, so replacing yours restates
-- nothing you have already signed.
CREATE TABLE staff_signatures (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key   TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  uploaded_at  TEXT NOT NULL,

  -- Cleared rather than deleted. The row stays so that documents signed with this
  -- specimen keep resolving; it simply stops being the one offered for new signatures.
  retired_at   TEXT
);

-- Finding somebody's current specimen, which is the newest one not retired. Ordered
-- descending in the index because that lookup happens on every visit to a document
-- that needs signing.
CREATE INDEX idx_staff_signatures_current
  ON staff_signatures (user_id, retired_at, uploaded_at DESC);

-- Which specimen was used. Null for everything signed before this existed, and for
-- every acknowledgement - a handbook policy is acknowledged rather than signed, and
-- carries no image.
--
-- SET NULL rather than CASCADE: losing the picture must never take the record of the
-- signature with it. The evidence that stood up before this feature - who, when, from
-- where, against which hash - stands up on its own, and a signed copy with a missing
-- image says so plainly rather than vanishing.
ALTER TABLE document_signatures
  ADD COLUMN signature_id TEXT REFERENCES staff_signatures(id) ON DELETE SET NULL;
