-- The annual independence declaration.
--
-- The portal has been asking for this document in three places and never had it. The
-- onboarding programme carries a step called "Complete the annual independence
-- declaration" (shared/hr.ts), the seeded independence policy tells everyone to
-- "complete the annual independence declaration when it is issued to you"
-- (pol_independence, 0004), and docs/PORTAL.md says onboarding covers completing it. No
-- such document existed, so the step could only ever be ticked on trust and the policy
-- pointed at nothing.
--
-- ## Why a signed form rather than another policy
--
-- A policy is one text everybody acknowledges: it states what the firm requires. A
-- declaration is the opposite direction of travel - each person asserts something about
-- themselves, and what the firm needs afterwards is evidence of who asserted it and
-- when. So `requires_signature`, which captures the typed name, the timestamp, the
-- address it came from and a hash of the exact text agreed to, rather than
-- `requires_acknowledgement`, which records only that somebody clicked.
--
-- Seeded as kind `form` so it sits with the documents a person completes rather than
-- among the handbook policies they read, and at position 20 so it lists after the
-- policies and before the contract templates.
--
-- ## How "annual" works, with no new machinery
--
-- Amending the body of a PUBLISHED document raises its version, and the
-- outstanding-documents query matches signatures against the current version - so last
-- year's signature stops counting the moment the text changes, and the declaration
-- reappears on everyone's outstanding list. See the comment on PATCH /api/documents/:id.
--
-- That is exactly the annual cycle, already built. Each year an HR administrator edits
-- one field, the year ending date at the top, and the firm is asked again. The previous
-- signatures survive as the record of what was declared in prior years, which is the
-- part that matters when somebody asks three years later who had declared what.
--
-- Nothing schedules that edit. A deadline reminder job would be the natural home for it
-- and does not exist yet; docs/REVIEW.md already ranks that first.
--
-- ## Seeded as a draft
--
-- Like every other document seeded with this system, and for the same reason: this is a
-- drafting starting point, not a finished instrument, and an attestation carrying
-- disciplinary consequences should be read by a partner before it is put in front of
-- anybody. Two bracketed fields have to be completed before it can be published - the
-- year end, and who to write to when there is something to declare - and the portal's
-- own admin screen shows it plainly as a draft with a Publish button.
INSERT OR IGNORE INTO documents
  (id, kind, category, title, summary, body, version, status,
   requires_signature, requires_acknowledgement, audience, position,
   created_at, updated_at)
VALUES
  ('frm_independence_declaration', 'form', 'Compliance',
   'Annual Independence and Conflicts Declaration',
   'Signed once a year by everyone. Confirms no undisclosed financial interest, relationship, position or benefit involving a client - and records what has been declared where there is something.',
   '## Annual Independence and Conflicts Declaration

**For the year ending [YEAR END DATE].**

Every member of the firm completes this declaration once a year. It is how we
demonstrate, to ourselves and to anyone who asks, that the opinions and returns
we sign carry no undisclosed interest behind them. Our work is worth something
only because we are independent of the people we report on, and a declaration
nobody takes seriously is worse than none at all.

Read every paragraph before you sign. If anything applies to you, **declare it
first and sign afterwards** - see *How to declare something* at the end.

## 1.  Financial interests

I confirm that neither I, nor my spouse or partner, nor any dependent of mine,
holds any financial interest in a client of the firm - including shares, loans,
guarantees, or any beneficial interest held through another person - other than
anything I have declared under this process.

## 2.  Personal and family relationships

I confirm that I have no close personal or family relationship with a client of
the firm, or with a director, officer, or employee of a client who is in a
position to influence the subject matter of our work, other than anything I have
declared.

## 3.  Positions held

I confirm that I hold no position as a director, officer, trustee, or member of
the management of any client of the firm, and that I take no part in the
management decisions of any client.

## 4.  Employment discussions

I confirm that I am not in discussion about employment with any client of the
firm, and that I have not accepted an offer of employment from a client. I
understand that I must report any such discussion the moment it begins, and that
I must be removed from that client''s work while it continues.

## 5.  Gifts and hospitality

I confirm that I have neither solicited nor accepted from any client any gift,
hospitality, payment or other benefit beyond a modest and clearly inconsequential
value, other than anything I have declared.

## 6.  Fees and client money

I confirm that I have at no time received money from a client into a personal
account, whether in payment of the firm''s fees, in settlement of a client''s tax
or statutory liability, or for any other reason.

## 7.  Audit and assurance engagements

Where I have worked on an audit or other assurance engagement during the year, I
confirm that none of the circumstances in paragraphs 1 to 6 applied to me in
respect of that client at any time during the period covered by the engagement or
during the engagement itself, and that I was not employed by that client during
the period the stricter requirements of the policy cover.

If you have worked on no audit or assurance engagement this year, this paragraph
does not apply to you and you may sign without it.

## 8.  Conflicts between clients

I confirm that I am not aware of any matter on which the firm acts, or has been
asked to act, for two clients whose interests conflict, that I have not reported.

## 9.  Continuing obligation

I understand that this declaration speaks as at the date I sign it, and that it
does not discharge me for the rest of the year. If any of the circumstances above
arises after I sign, I must report it **at once** and not wait for the next
declaration.

## 10.  Consequences

I understand that a knowingly false declaration, or a failure to declare
something that falls within it, is a disciplinary matter capable of amounting to
gross misconduct, and may also be a breach of the ethical standards of my
professional body.

---

## How to declare something

**Do not sign this document until you have done so.**

If any paragraph above applies to you, write to [DECLARATION CONTACT] setting out
what it is, who it concerns, and when it arose. You will be told what happens
next - usually that you are taken off the affected client''s work, sometimes that
nothing needs to change. Once the firm has recorded it, sign this declaration:
your signature then confirms that everything that applies to you has been
declared, not that there was nothing to declare.

Declaring something is not an admission of wrongdoing. Holding shares in a client
is not misconduct; holding them quietly is. Nobody has ever been disciplined at
this firm for declaring an interest, and the process only works if that stays
true.

If you are unsure whether something counts, declare it and ask. The cost of a
declaration that turned out to be unnecessary is five minutes of somebody''s time.
The cost of the other mistake is an opinion we cannot stand behind.

---

By signing on the portal, I confirm that I have read this declaration in full,
that each paragraph is true of me as at today''s date, and that anything which
would otherwise make a paragraph untrue has already been declared to the firm.',
   1, 'draft', 1, 0, 'all', 20, datetime('now'), datetime('now'));
