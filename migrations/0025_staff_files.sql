-- Documents a member of staff attaches to their own record.
--
-- Two of them: identification and a qualification certificate. shared/staff-files.ts
-- argues for why these are held by the portal when client working papers deliberately
-- are not - briefly, a new joiner photographing their passport on their first morning
-- has nowhere in the firm's document store to put it, and asking them for a link to a
-- file nobody has given them anywhere to upload is asking them to solve the firm's
-- filing problem before they have a desk.
--
-- The bytes live in R2. This table is the index: what the object is called, what it
-- was called when it arrived, and enough to hand it back with the right content type.
-- The two are kept in step by the account-removal path, which deletes the objects as
-- well as these rows - a row disappearing while a passport scan stays in the bucket is
-- the failure that matters here.
--
-- The profile column each one fills in is unchanged. An attachment is written into the
-- existing `id_document_url` / `qualification_document_url` column as `portal:<id>`,
-- which no URL collides with, so every question already asked of those columns - has
-- this person supplied their identification, is their first run complete - keeps
-- working, and a SharePoint link recorded before this existed is still a link.
CREATE TABLE staff_files (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('identification', 'qualification')),
  object_key   TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  uploaded_at  TEXT NOT NULL,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- One current attachment per person per kind. Replacing one deletes the row and the
-- object it points at rather than accumulating versions: this is a copy of a document
-- the person holds, not a record of what it used to say.
CREATE UNIQUE INDEX idx_staff_files_current ON staff_files (user_id, kind);
