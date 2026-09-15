# The employee portal

The portal is where someone joining the firm is onboarded, and where they stay
for the rest of their employment: their contract, the handbook, their own
records, and the client work assigned to them all live behind one sign-in.

- **[WORKFLOW.md](./WORKFLOW.md)** covers client deliverables and the review cycle.
- This document covers onboarding, documents and HR records.

---

## What a new joiner sees

A partner creates the account, fills in the employment record, and starts the
onboarding programme. The new joiner signs in with a temporary password and lands
on **My onboarding**, which shows:

1. **A progress bar** across three things: their own onboarding steps, the
   documents they owe a response to, and whether their personal details are
   complete.
2. **The welcome message from the Managing Director** - markdown, edited in
   Portal settings, signed with the MD's name and title.
3. **Documents to read and sign** - their contract first, then handbook policies.
4. **Their personal details** - with a direct list of what is still missing.
5. **Their own steps** - tickable.
6. **What the firm is doing for them** - the HR-side steps, visible but not
   tickable by them, so they can see the firm is doing its part.
7. **Their signed documents** - a permanent record they can return to.

Until they set their own password, the API confines them to the account screen
and their onboarding - a temporary password cannot be used to reach client work.

---

## Documents: contracts, policies, notices

One table backs all of them, distinguished by `kind` and by what response they
require.

| | Contract | Handbook policy |
| --- | --- | --- |
| `kind` | `contract` | `policy` |
| `audience` | `individual` - one named employee | `all` |
| Response | **Signature** | **Acknowledgement** |
| Where it appears | Onboarding, then their document list | The handbook |

**Lifecycle.** Draft → published → archived. Nothing is visible to staff, and
nothing can be signed, until a partner publishes it. The seeded handbook ships as
drafts deliberately: the policies need review against the law that applies to the
firm before anyone is asked to agree to them.

**Signing.** The employee reads the document, ticks an explicit attestation, and
types their full name. The system:

- requires the typed name to match the name on their account (case and internal
  spacing are forgiven; a different name is not);
- disables the control until they have scrolled to the end of the text;
- stores a **SHA-256 hash of the exact text** they agreed to, plus the timestamp,
  IP address and user agent;
- keys the record to the **document version**, and refuses a second response to
  the same version.

**Amendment is the interesting part.** Editing the text of a *published* document
raises its version. Because outstanding-document queries compare signatures
against the current version, the amended policy reappears in everyone's list and
must be acknowledged again - while the earlier signatures survive as a record of
what was agreed before, provable against the stored hash. Editing a draft changes
nothing, because nobody has agreed to it yet.

The seeded handbook covers: code of conduct and ethics, client confidentiality
and data protection, independence and conflicts of interest, anti-money
laundering, IT security and acceptable use, leave and absence, working hours and
remote work, equal opportunity and anti-harassment, performance and development,
grievance and disciplinary procedure - plus two contract templates to copy per
person: a contract of employment, and an Associate Consultant Agreement for
independent contractors engaged on a contract *for* service.

Alongside them is the **Annual Independence and Conflicts Declaration**, which
everyone signs once a year. Unlike a policy, which the firm states and staff
acknowledge, a declaration is each person asserting something about themselves, so
it is captured as a signature: typed name, timestamp, address and a hash of the
exact text. Two bracketed fields have to be completed before it is published - the
year end, and who to write to when there is something to declare.

**Re-issuing it each year needs no new feature.** Amending the body of a published
document raises its version, and outstanding-document queries match signatures
against the current version, so editing the year end puts the declaration back in
front of everybody and leaves every previous year's signature standing as the
record of what was declared then. Nothing schedules that edit; it is a diary note
for whoever runs HR.

---

## Probation and annual reviews

Each review rates the person against the criteria that apply at their grade - technical
competence, quality of submitted work, deadlines, client handling, judgement, conduct,
development, and supervision from Senior Associate up. Four points, and deliberately no
middle: a five-point scale in a small firm becomes everybody scoring three, which records
nothing, tells the person nothing they can act on, and is worth nothing when a decision
turns on it. A rating below expectation is refused without a comment saying what has to
change.

**A review has two voices.** The reviewer writes it, then sends it; the person reads it,
adds their own comments and signs. Their comments are theirs - no reviewer route writes
that column - and they stay on file whether the person agrees or not. Signing records
that they have read it, not that they accept it, and the screen says so.

**A draft is private to its author.** Half-formed judgements about a colleague are not
readable by that colleague, enforced on every path rather than by a screen simply not
linking to them. A peer cannot read a review at any stage, whatever their grade: the
people who can are the subject, their line manager, and HR administration.

**Once both have signed, nothing amends it.** Not the ratings, not the narrative, not the
outcome. A record that can be revised after the fact is worth nothing at the only moment
it is ever needed. Anything further goes in a new review. Withdrawing a review from
somebody after they have seen it is allowed, and is written to the HR trail.

**Probation reviews decide.** Confirm, extend or do not confirm, and an extension needs a
date to work towards. Objectives set in one review are judged in the next, so the open
ones appear on the person's file waiting for that.

---

## HR records and who can see what

Employee data is split across three tables, because the three groups have
genuinely different audiences. Splitting them means a query that forgets a filter
cannot leak the most sensitive fields.

| Data | Table | Who can see it |
| --- | --- | --- |
| Job title, department, grade, start date, probation date, line manager | `employee_profiles` | Manager grade and above, plus the employee |
| Date of birth, home address, phone, emergency contact, next of kin | `employee_profiles` (personal columns) | **The employee and HR administrators only** |
| Salary, bank details, tax and social security numbers | `employee_compensation` | **Partner grade only**, plus the employee's own |

A line manager deliberately does **not** get their reports' home addresses or
dates of birth. They have no working need for them.

**Who maintains what.** The employee maintains their own contact details,
emergency contact, next of kin and qualifications. They cannot change their own
job title, grade, start date or pay - those are HR-controlled, and the API
rejects the attempt rather than ignoring it.

**The HR trail** (`hr_events`) is append-only and records employment record
changes, document signatures, onboarding progress and pay amendments. Pay changes
are recorded as *having happened* without writing the values into the trail.

---

## The onboarding programme

Nineteen standard steps, created per person when their account is made, split
between the new joiner and HR, **ordered into five stages** and dated from the
person's start date. It is defined in
[`shared/onboarding.ts`](../shared/onboarding.ts) and shared by the Worker and the
browser, so the programme, the stage a person is at, and the dates on screen are
computed from one definition rather than three.

| Stage | Due | What it is for |
| --- | --- | --- |
| Before you start | Day -1 | The firm's own preparation. Nothing here is the joiner's. |
| Your first sign-in | Day 0 | Everything the firm needs from the joiner, asked once. |
| Your first week | Day +5 | Reading and signing what they are agreeing to, and induction. |
| Your first month | Day +30 | The compliance obligations that come with the work. |
| Your first review | Probation end | Objectives set, then judged. |

Where no start date has been recorded the stages carry no dates at all, rather
than dates counted from today - which would put every step in the past the moment
an incomplete record is opened. The first review is pinned to the probation end
date, not to an offset, because that is the date the review is actually held on.

**Which programme somebody gets follows their employment type.** An employee is
registered for PAYE and SSNIT; an Associate Consultant settles their own tax and
pension, so their programme confirms their GRA registration and invoicing
arrangements instead. That single step is the whole difference, deliberately: an
Associate still signs a contract, still gives bank details because they are still
paid, still acknowledges the conduct standards, still completes the independence
declaration, and still gets objectives and a first review. The contract template
named on the first step follows the same distinction - Contract of Employment, or
Associate Consultant Agreement.

**"Where you have got to" is measured by the person's own steps**, not by
everything on the list. Measured across the firm's steps as well, a new joiner on
their first morning would be told they were at "Before you start" - a stage made
entirely of things the firm does - and would go looking for something to act on
that was never theirs. Where they have nothing outstanding anywhere, the stage
shown is the first one the firm has not finished, which is the honest "waiting on
us".

Document signing is tracked through `documents` rather than duplicated as
checklist items, so ticking "sign your contract" and actually signing it cannot
disagree.

### The first sign-in is a gate

Three steps, in this order, defined in
[`shared/first-run.ts`](../shared/first-run.ts):

1. **Their onboarding** - fifteen fields, all required: contact and emergency
   contact, identification and right to work, qualifications, and bank details.
2. **A password of their own**, replacing the temporary one they were emailed.
3. **Two-step sign-in**, where their grade requires it.

Onboarding first, at the firm's request. Being dropped straight onto a password
form, before anything has explained what the portal is or what is coming, tells
somebody nothing about the firm they have joined. The onboarding page does: the
welcome, the five stages, the dates, and what is theirs to do.

That leaves the temporary password usable for a little longer, and it is worth
being plain that this costs less than it looks. A temporary password that reaches
the portal at all is already an account takeover waiting to happen in either
order: whoever holds it can sign in and set a password of their own, which is the
first thing they would do. What protects the firm is the confinement, not the
sequence - on any of the three steps the person reaches their own account screen
and their own onboarding and nothing else, and the API answers `403
first_run_pending` to everything else.

The Worker and the browser read the same module: the server decides what a request
may reach, the browser decides where to send somebody, and a browser routing to
the password screen while the server still demands onboarding is a loop with no
way out. The onboarding checklist is ordered to match, so it never tells somebody
to do something the portal is not asking for yet.

The reason for the gate is that this information is what the firm cannot proceed
without and cannot get any other way. A contract cannot be completed without a
legal name, address and TIN; the person cannot be paid without bank details; and
right-to-work evidence is a statutory obligation with a deadline attached. Asked
optionally, it arrives weeks late or not at all.

**Everything else remains surfaced, not enforced.** An employee with an unsigned
contract still gets to their work queue; the outstanding items sit prominently on
their portal and on the HR overview. Blocking work would punish the employee for a
delay that is often the firm's.

---

## Downloading a signed copy

Everything a typed-name signature needs to stand up was already recorded - who
signed, the name they typed, when, from what address, on which version, and a
SHA-256 of the exact text agreed to. All of it lived in a row the signatory could
not obtain, so somebody asked for their contract by a bank or a landlord had a
screenshot to offer.

`GET /api/documents/:id/signed-copy` returns the whole thing as one self-contained
file: the document as they read it, then an **electronic signature certificate**
setting out the evidence, styled to print to a clean PDF from any browser. A
person may download their own; an HR administrator may download anybody's, because
the personnel file is theirs to keep; nobody else, at any grade.

**The file re-checks itself.** The hash recorded at signature is compared with the
hash of the text actually in the file, and the certificate says which it found. If
the document has been amended since - which raises its version and asks the person
to sign again - the certificate says so in terms, and tells the reader to treat the
text as the current wording rather than the signed one. A signed copy that has
drifted from what was signed is worse than no copy, because it looks convincing.

**One grammar, two renderers.** The markdown parser lives in
[`shared/markdown.ts`](../shared/markdown.ts) and produces a small tree;
`src/components/Markdown.tsx` turns it into React elements for the screen and
`renderMarkdownHtml` turns the same tree into HTML for the download. Written
separately, the two could disagree about a numbered list or a bold run - and the
person would have signed one thing and be holding another.

It is HTML rather than PDF because a PDF writer that lays out a fifteen-page
agreement well is a large thing to carry in a Worker, and every browser already
prints to PDF. Every value is escaped on the way in, including the firm's own
settings: a signed copy is a file the firm hands to an employee and the employee
hands to a bank, and nothing in the portal should be able to put script into it.

The certificate states what the firm recorded and how to check it. It does not
claim to be a qualified electronic signature or to satisfy any jurisdiction,
because whether a typed name is a signature where the firm operates is a legal
question and not one a file settles by asserting it.

---

## Completing a contract

Both contract templates are written with bracketed placeholders - `[JOB TITLE]`,
`[ASSOCIATE TIN]`, `[NOTICE DAYS]`. Thirty-eight of them in the Associate
agreement. Replacing them by hand, per person, in a fifteen-page instrument, is
how a contract comes to be signed saying the notice period is `[NOTICE DAYS]`
days.

[`shared/contract-fields.ts`](../shared/contract-fields.ts) says, for every
placeholder in both templates, where its value is supposed to come from. Three
answers, and the distinction is the whole design:

| | Where it lives | Who supplies it |
| --- | --- | --- |
| **From the record** | `users`, `employee_profiles`, `employee_compensation`, settings | Nobody types it again |
| **A firm-wide term** | `settings.contract_defaults` | Set once, in Portal settings → Contract terms |
| **This person only** | `contract_details` | The administrator, when the account is created |

**Nothing already in the record is copied.** Their name, job title, start date,
salary and address are read from where they already are. A second copy of a job
title is how a contract comes to disagree with a personnel file.

**The standard terms are set once.** The registered company name, the notice
period, the payment days, the fee for each tier - the same in every contract the
firm issues. Asking an administrator to retype twenty-five of those per person
guarantees the twenty-sixth Associate is engaged on different ones. Terms with a
conventional value start from it, and the screen says so, because the failure to
guard against is not a blank field: it is a firm issuing thirty contracts on a
notice period nobody ever chose. A per-person value overrides a firm-wide one,
for the case where terms were negotiated.

### What the administrator does not have

Three of the placeholders describe the person rather than the engagement: their
residential address, their TIN and their Ghana Card number. An administrator who
has them types them in when the account is created. One who does not leaves them
blank - they are among the fifteen things asked at first sign-in, so the gap
fills itself, and the contract reads from the same column either way. The screen
says which of the outstanding fields those are, because "six fields outstanding"
sends somebody chasing three things that were going to answer themselves.

### Issuing

`POST /api/documents/:id/copy-for` substitutes everything it can as it makes the
copy, and reports what is left in three groups: `filled`, `outstanding` (a merge
field was meant to fill it and could not), and `manual` (nothing was ever going
to - the assigned-client schedule, and the date beside each signature).

**A blank value is not substituted.** Replacing `[ASSOCIATE TIN]` with an empty
string produces "holding Taxpayer Identification Number and Ghana Card number
...", which is grammatical, reads as finished, and is wrong. The bracket stays,
which is ugly, and ugly is the only version somebody notices before it is issued.

Dates are written out - a contract commences on 1 October 2026, not on
2026-10-01 - while the form that collects them still holds the ISO string its
date input needs.

---

## The staff directory

A practice needs a phone list. Somebody preparing a return has to be able to find
out who reviews for the tax team, what a colleague's job title is and which
address to use, and asking around for that is how a new joiner spends their first
fortnight. So `/directory` is open to everybody.

**What differs by grade is not who appears but what is said about them.**

| | Shown |
| --- | --- |
| Everybody | Name, grade, job title, department, work email, location, who they report to |
| Manager and above | The same, plus employment status, staff number and start date - and a link through to the personnel file |
| Nobody, here | Personal phone or address, date of birth, next of kin, pay, bank details, identification, qualifications |

Employment status is the one that is easy to miss: `probation` on a directory
card tells the whole firm something that is between a colleague and their manager.
The fields a reader below Manager grade must not receive are left out of the
`SELECT` rather than deleted from the rows afterwards - filtering after the fact
works until somebody adds a column and forgets the filter.

Alongside the grade rule there is a work rule, which adds rather than subtracts:
the directory marks the colleagues you share live deliverables with, and how many.
That is the half of "who do I talk to" a grade cannot answer. Closed and cancelled
deliverables do not count - a figure that sends somebody to talk about a job that
finished is worse than no figure.

Retired accounts are left out. They are kept so the client work still shows who
prepared and who reviewed each job, but "Former colleague" at an unroutable
address is an entry nobody can act on. A **suspended** colleague does stay:
somebody on leave is still a colleague.

This is separate from `/people`, which is the personnel directory and stays at
Manager grade under the `people` area setting. The staff directory does not
loosen it.

---

## Removing somebody

**Accounts and grades → Remove.** Two removals, and deleting outright is the
default, because that is what an administrator who opened the screen came to do.

| | What happens |
| --- | --- |
| **Delete everything** | The user row goes, cascades and all |
| **Keep their client work, remove the person** | The personal record goes; the row stays, anonymised, so the client work keeps the shape of who did what |

What the dialog owes an administrator is the truth about what goes with them,
because "delete the account" sounds like one action on one row and it is not. A
user row is referenced by forty-odd columns and about a third of them cascade.
Measured against the real schema with foreign keys on, as D1 enforces them:
deleting a reviewer removes the review round, the review point and the comment
from **somebody else's** deliverable, and leaves that deliverable in
`under_review` with no reviewer and no record of what was asked for. Deleting a
preparer takes the hours logged against the client. That measurement is a test, so
if the schema is ever fixed the wording can be softened deliberately rather than
drifting.

So the counts are shown, plainly, and then the button does what it says. An
earlier version recommended retiring instead once somebody had touched any client
work; that was the wrong call. A screen that answers "would you not rather do
something else" to a decision its owner has already made is arguing rather than
informing.

The confirmation is the person's own name rather than a fixed word. "DELETE" can
be typed without reading; the point is not friction but making somebody look at
which account they have selected.

Three removals are refused outright, whichever option is chosen: your own account,
an account senior to you, and the last active administrator. The reason is shown
before anybody types a confirmation rather than at the point of failure.

---

## Where things are

| Screen | Path | Who |
| --- | --- | --- |
| My onboarding | `/onboarding` | Everyone |
| Employee handbook | `/handbook` | Everyone |
| A document, with signing | `/documents/:id` | Whoever it is addressed to |
| My details | `/my-profile` | Everyone |
| Staff directory | `/directory` | Everyone |
| People directory and onboarding progress | `/people` | Manager and above |
| Personnel file | `/people/:id` | Self, manager, HR - by section |
| Portal settings: handbook, welcome, logo, email | `/portal-admin` | Partner and above |
| Contract terms (firm-wide) | `/portal-admin?tab=contract` | HR reads, Partner writes |
| One person's contract details | `/people/:id` → Contract details | HR administrator |
| Accounts and grades | `/team` | Partner and above |

---

## Before you use it for real

- **Have the handbook reviewed.** The seeded policies are drafting starting
  points, not finished legal instruments. Review each against the employment law
  and professional standards that apply to the firm, then publish. They ship as
  drafts so this cannot be skipped by accident.
- **Set the firm's standard contract terms** before issuing anything. Portal
  settings → Contract terms. The registered company name, the company number and
  the registered office have no sensible default and will print as brackets until
  they are set; the rest start from a conventional value, which is a starting
  point rather than the firm's decision. Do not publish either template itself to
  staff - a template is copied per person, and the copy is what gets signed.
- **An Associate is not an employee**, and the programme now says so: set their
  employment type to Consultant or Contractor when the account is created and they
  get the Associate programme and the Associate agreement, with no payroll
  registration. Leave the salary fields empty - they invoice against the agreement
  rather than being paid through payroll. Check the finished checklist before
  issuing it: every step that treats a contractor as an employee is evidence
  against the arrangement their contract describes.
- **Check whether typed-name signatures satisfy your jurisdiction** for
  employment contracts. The record captured here - attestation, matched name,
  timestamp, IP, and a hash of the exact text - is strong evidence of agreement,
  but whether it constitutes a valid signature is a legal question, not a
  technical one.
- **Certificates and identification are links**, not uploads. They point at your
  document store. Cloudflare R2 is the natural place to add real uploads.
- **Notifications are in-app only.** New joiners will not receive an email when a
  policy is published; they see it in their inbox on the portal.
