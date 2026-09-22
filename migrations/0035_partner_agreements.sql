-- The engagement a growth partner signs before they sell anything.
--
-- A growth partner represents the firm to businesses that have never heard of it, and
-- earns a share of what those businesses pay. Both of those need an instrument behind
-- them, signed by the person doing it, before they start - which is what this is.
--
-- Three things about the shape.
--
-- **The body is frozen onto the agreement, not joined to a template.** The terms in it
-- are that partner's own - their rate, their months, their hold - and the template will
-- be edited. A partner who signed at 25% in 2026 must go on holding a document that says
-- 25%, whatever the firm's standard becomes. So the text is written out in full when the
-- agreement is issued, with a SHA-256 of exactly what they agreed to.
--
-- **It is not `document_signatures`.** That table's `user_id` is a foreign key onto
-- `users`, and a growth partner is deliberately not a user - see 0034. Rather than
-- rebuild a table three years of signatures already sit in, a partner's engagement has
-- its own row, which is honest: it is a different instrument from a contract of
-- employment and is evidenced differently.
--
-- **The signature image lives beside it.** The object key and its type are on the row
-- rather than in a specimen library, because a partner signs one document once and a
-- library of specimens for a population that signs once is a library nobody reads.
-- shared/signatures.ts still decides what may be uploaded, and why the list is short.

CREATE TABLE partner_agreements (
  id         TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES growth_partners(id) ON DELETE CASCADE,

  -- The document as issued, in full. See the header.
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  content_hash TEXT NOT NULL,

  -- The terms as they stood when it was issued, so the row explains itself without
  -- anybody having to read the body to find out what was agreed.
  commission_rate   REAL NOT NULL,
  commission_months INTEGER NOT NULL,
  hold_days         INTEGER NOT NULL,

  status TEXT NOT NULL DEFAULT 'issued'
           CHECK (status IN ('issued', 'signed', 'superseded')),

  issued_at   TEXT NOT NULL,
  issued_by   TEXT REFERENCES users(id) ON DELETE SET NULL,

  -- What they typed, which the Worker requires to match the name on their account.
  typed_name  TEXT,
  signed_at   TEXT,
  ip_address  TEXT,
  user_agent  TEXT,

  -- The image they signed with, in the bucket. Null until they have signed.
  signature_key  TEXT,
  signature_type TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_partner_agreements_partner
  ON partner_agreements (partner_id, issued_at DESC);

-- One live agreement per partner. A new one supersedes the old rather than sitting
-- beside it, so "what did they agree to" has one answer.
CREATE UNIQUE INDEX idx_partner_agreements_live
  ON partner_agreements (partner_id) WHERE status IN ('issued', 'signed');

-- ---------------------------------------------------------------------------
-- The template
-- ---------------------------------------------------------------------------
--
-- Held in `documents` like the other two instruments, so it is edited on the same screen
-- and versioned the same way. It is not assigned to anybody and requires no signature
-- there: it is the text an agreement is cut from, and the signing happens on the
-- agreement row above.
INSERT INTO documents
  (id, kind, category, title, summary, body, version, status, audience,
   requires_acknowledgement, requires_signature, created_at, updated_at)
VALUES (
  'tpl_growth_partner',
  'form',
  'Contracts',
  'Growth Partner Engagement',
  'The engagement a growth partner signs before selling for the firm. Their own terms are written into a copy of this when they are admitted.',
  '# GROWTH PARTNER ENGAGEMENT

**Between** [FIRM LEGAL NAME] (the "Firm") **and** [PARTNER NAME] (the "Growth
Partner").

## 1. What this is

The Growth Partner introduces and sells the Firm''s services to businesses, in
consultation with the Firm. The Growth Partner is not an employee, an agent with
authority to bind the Firm, or a partner in it. Nothing in this agreement creates a
partnership, a joint venture or an employment relationship.

## 2. What the Growth Partner does

2.1 The Growth Partner registers a business in the Firm''s portal before working on it.
Registration is what records who is working on a business and when they started.

2.2 The Growth Partner may pitch the Firm''s services, prepare and send a proposal from
the Firm''s published packages, and see a proposal through to the point of engagement.

2.3 The Growth Partner does not agree a price the Firm has not published or approved,
does not sign anything on the Firm''s behalf, and does not hold client money.

2.4 The Firm attends meetings where one of its people is needed. The Growth Partner asks
for that in good time rather than committing the Firm to an appointment.

## 3. Exclusivity on a registered business

3.1 Registering a business gives the Growth Partner [HOLD DAYS] days during which no
other growth partner may register the same business.

3.2 The hold ends early if the Growth Partner records that the business is not
proceeding. The Firm may extend a hold where a sale is still moving, and records why.

3.3 A hold is not a claim on a business the Firm already acts for, nor on one that
approaches the Firm independently.

## 4. Commission

4.1 Where a business the Growth Partner registered becomes a client of the Firm on a
subscription, the Growth Partner is entitled to [COMMISSION RATE]% of the subscription
fee actually charged to that client for its first [COMMISSION MONTHS] **billed** months.

4.2 Billed months are months for which the Firm has issued an invoice. A month in which
the client''s subscription is paused is not a billed month, and does not count towards
the [COMMISSION MONTHS].

4.3 Commission is worked out on the amount charged after any discount and before tax.

4.4 Where a client only ever engages the Firm for one-off work and is never on a
subscription, the Growth Partner is entitled to [COMMISSION RATE]% of that work, once per
assignment, and only on work invoiced within [COMMISSION MONTHS] months of the client
being signed. An assignment that recurs annually earns commission once.

4.5 Where a client is on a subscription, one-off work for that client earns no further
commission.

4.6 Commission accrues when the Firm issues the invoice, is approved by the Firm, and is
paid after that. An invoice that is cancelled cancels the commission accrued on it,
unless that commission has already been paid.

## 5. Conduct

5.1 The Growth Partner describes the Firm''s services accurately and does not state or
imply terms the Firm has not published.

5.2 The Growth Partner keeps confidential anything learned about the Firm''s clients,
fees or working papers, during this engagement and afterwards.

5.3 The Growth Partner complies with applicable law, including data protection law, in
approaching and dealing with businesses.

## 6. Tax and status

The Growth Partner is responsible for their own tax and for any registrations their own
circumstances require. Commission is stated gross; the Firm deducts and remits
withholding tax where the law requires it.

## 7. Ending it

7.1 Either party may end this engagement on thirty days'' written notice.

7.2 Commission already accrued on invoices already issued survives the ending of this
engagement and is paid in the ordinary course.

7.3 The Firm may suspend access to the portal immediately where it reasonably believes
clause 5 has been breached. Suspension stops further selling; it does not take away
commission already earned.

## 8. General

8.1 This agreement is governed by the laws of the Republic of Ghana.

8.2 It replaces any earlier understanding between the parties about the same subject.

---

Signed for the Firm: [FIRM LEGAL NAME]

Signed by the Growth Partner: [PARTNER NAME]

Dated: [AGREEMENT DATE]
',
  1,
  'published',
  'all',
  0,
  0,
  '2026-09-21T00:00:00.000Z',
  '2026-09-21T00:00:00.000Z'
);
