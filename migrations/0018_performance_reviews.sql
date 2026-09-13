-- Probation and annual performance reviews.
--
-- The portal has held an employment record, an onboarding programme and an HR audit
-- trail since 0003, and had nothing at all on performance. The onboarding programme even
-- carries an HR step called "Set probation objectives and diarise the probation review",
-- with nowhere to record either.
--
-- Three tables rather than one wide row, for the reason the HR records were split in the
-- first place: these have different lifetimes. A review is written once and then frozen.
-- A rating belongs to exactly one review. An objective is set in one review and assessed
-- in the next, so it outlives the review that created it and has to be addressable on
-- its own.

-- ---------------------------------------------------------------------------
-- The review
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS performance_reviews (
  id           TEXT PRIMARY KEY,
  subject_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('probation','annual','interim')),

  -- What period is being reviewed. The label is what people call it ("FY2026",
  -- "Probation to March"); the dates are what a report can sort and filter on.
  period_label TEXT,
  period_start TEXT,
  period_end   TEXT,

  -- Who wrote it. Kept even if they later leave, which is why this is SET NULL rather
  -- than CASCADE: deleting the reviewer's account must not delete the record of a
  -- decision the firm made about somebody else.
  reviewer_id  TEXT REFERENCES users(id) ON DELETE SET NULL,

  status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','shared','complete')),

  overall      TEXT CHECK (overall IN ('below','meets','strong','outstanding')),

  -- The reviewer's narrative. Separate fields rather than one box, because "what should
  -- change" is the half people leave out when there is only one.
  strengths         TEXT,
  development       TEXT,
  reviewer_comments TEXT,

  -- The employee's own words. Nobody but the subject may write here - see the route.
  -- Kept whether they agree or not: a performance record with one voice in it is a
  -- record of what one person thought, and is worth what that is worth.
  employee_comments TEXT,

  -- Probation only. `extend_to` is the date the extended period runs to.
  probation_decision  TEXT CHECK (probation_decision IN ('confirm','extend','not_confirmed')),
  probation_extend_to TEXT,

  -- Signatures. Two, and the review is complete only when both are present.
  reviewer_signed_at TEXT,
  employee_signed_at TEXT,

  shared_at    TEXT,
  completed_at TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- The employee file lists somebody's reviews newest first; the reviewer's own queue
-- looks the other way round.
CREATE INDEX IF NOT EXISTS idx_reviews_subject
  ON performance_reviews (subject_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer
  ON performance_reviews (reviewer_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON performance_reviews (status);

-- ---------------------------------------------------------------------------
-- Ratings against the criteria
-- ---------------------------------------------------------------------------
--
-- `criterion` holds the key from shared/performance.ts rather than a foreign key into a
-- criteria table, because the criteria are code rather than data - the firm chose a
-- fixed list. A criterion later retired therefore leaves its old ratings readable, which
-- is what you want: a review from 2026 should still say what it said in 2026, even if
-- the firm has since stopped rating that thing.
CREATE TABLE IF NOT EXISTS review_ratings (
  review_id TEXT NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
  criterion TEXT NOT NULL,
  rating    TEXT CHECK (rating IN ('below','meets','strong','outstanding')),
  comment   TEXT,
  PRIMARY KEY (review_id, criterion)
);

-- ---------------------------------------------------------------------------
-- Objectives
-- ---------------------------------------------------------------------------
--
-- Set in one review and assessed in the next, which is the whole point of recording
-- them. `source_review_id` is where it was set; `assessed_in_id` is the review that
-- judged it, filled in when that happens. Both ON DELETE SET NULL, so an objective
-- outlives either review rather than vanishing with it.
CREATE TABLE IF NOT EXISTS review_objectives (
  id               TEXT PRIMARY KEY,
  subject_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_review_id TEXT REFERENCES performance_reviews(id) ON DELETE SET NULL,
  assessed_in_id   TEXT REFERENCES performance_reviews(id) ON DELETE SET NULL,
  objective        TEXT NOT NULL,
  target_date      TEXT,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','met','partly_met','not_met')),
  -- How it was judged, written at the review that assessed it.
  assessment       TEXT,
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- "What is still open for this person" is the query the next review starts from.
CREATE INDEX IF NOT EXISTS idx_objectives_subject
  ON review_objectives (subject_id, status, position);
CREATE INDEX IF NOT EXISTS idx_objectives_review ON review_objectives (source_review_id);
