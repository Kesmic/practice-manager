-- The client file: links to folders and documents held in SharePoint, OneDrive or
-- Google Drive.
--
-- No document content is stored here, only a reference to where it lives. The firm
-- already has a document store with its own retention rules, version history and
-- access control; copying documents into a second system would fork the truth and
-- double the places a confidentiality breach could come from. What the portal adds is
-- the index: which folder is this client's, and where is last year's computation.
--
-- Never edit an applied migration; add a new one.

CREATE TABLE client_files (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- Optional: a document that belongs to one engagement rather than to the client as a
  -- whole. ON DELETE SET NULL so removing an engagement leaves the link in the client
  -- file rather than losing the reference to a document that still exists.
  engagement_id TEXT REFERENCES engagements(id) ON DELETE SET NULL,

  kind          TEXT NOT NULL DEFAULT 'document' CHECK (kind IN ('folder','document')),
  -- Worked out from the link's hostname when it is saved, so the list can be scanned
  -- by where things live. Stored rather than derived on read because a link can be
  -- edited and the label should follow it.
  provider      TEXT NOT NULL DEFAULT 'other'
                  CHECK (provider IN ('sharepoint','onedrive','google_drive','other')),

  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  -- The firm's own filing structure, typed rather than chosen from a fixed list. Used
  -- to group the client file on screen.
  category      TEXT,
  -- "2025", "Q1 2026", "Year ended 31 Dec 2025": whatever the firm writes.
  period_label  TEXT,
  notes         TEXT,

  added_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- The client file is always read for one client, folders before documents.
CREATE INDEX idx_client_files_client ON client_files (client_id, kind, category);
CREATE INDEX idx_client_files_engagement ON client_files (engagement_id);
