# The practice workflow

This describes how a client deliverable moves from assignment to closure, and
which controls the system enforces rather than merely suggests.

The model follows the prepare / review / clear-points / sign-off cycle used in
accounting, tax and regulatory compliance practices - the same shape found in
Karbon, Canopy, TaxDome, Jetpack Workflow and Financial Cents, with the review
loop made explicit rather than left to comments on a task.

All of it lives in one file: [`shared/workflow.ts`](../shared/workflow.ts). The
Worker imports it to authorise every transition; the React app imports the same
functions to decide which buttons to show. There is no second copy of the rules
to drift out of step, and the browser cannot grant itself anything the server
will not also grant.

---

## Grades

| Grade                | Rank | May do                                                                 |
| -------------------- | ---- | ---------------------------------------------------------------------- |
| Associate            | 10   | Prepare work, tick procedures, log time, answer review points          |
| Senior Associate     | 20   | All the above, plus **review**: raise points, return for rework, approve |
| Manager              | 30   | Plus create clients, engagements and deliverables; assign; close files  |
| Partner              | 40   | Plus administer staff accounts; reopen closed files                     |
| System Administrator | 50   | Full access                                                             |

Two thresholds carry most of the weight:

- **Senior Associate and above may review.** An Associate can never be named as
  reviewer - the system refuses the assignment outright - and cannot review even where
  they are already named, which is what holds after a change of grade.
- **Manager and above may assign and close.** A Senior Associate may draft a
  deliverable, but a Manager releases it.

---

## The lifecycle

```
                                  ┌──────────────── Awaiting client ◄──┐
                                  │                                    │
                                  ▼                                    │
   Draft ──► Not started ──► In progress ──────────────────────────────┤
             (released)          │  ▲                                  │
                                 │  │                             On hold
                        submit   │  │ recall
                                 ▼  │
                            Submitted for review
                                    │
                          begin_review (a different person)
                                    ▼
                             Under review ──── approve ──► Approved
                                    │                          │
                            request_rework                   close
                                    ▼                          ▼
                            Rework required                 Closed
                                    │                          │
                               resubmit                     reopen
                                    │                    (Partner only)
                                    └──► Submitted for review   │
                                                                ▼
                                                          In progress

   Any live status ── cancel (Manager+) ──► Cancelled
```

### What each status means

| Status                  | Sits with     | Meaning                                              |
| ----------------------- | ------------- | ---------------------------------------------------- |
| **Draft**               | Supervisor    | Being set up; the associate cannot see it as work yet |
| **Not started**         | Preparer      | Released and waiting to begin                         |
| **In progress**         | Preparer      | Actively being worked                                 |
| **Awaiting client**     | Preparer      | Blocked on client information - the clock is paused   |
| **On hold**             | Preparer      | Suspended for an internal reason                      |
| **Submitted for review**| Reviewer      | Handed over, not yet picked up                        |
| **Under review**        | Reviewer      | Review round open; points being raised                |
| **Rework required**     | Preparer      | Points issued; corrections needed                     |
| **Approved**            | Supervisor    | Signed off, awaiting delivery and closure             |
| **Closed**              | -             | Delivered and filed. Read-only.                       |
| **Cancelled**           | -             | Abandoned, but retained for audit                     |

---

## The controls that actually bite

These are enforced server-side. The UI disables the corresponding button and
explains why, but removing the button is not what stops it.

**1. Nobody reviews their own work.**
Whoever is the deliverable's assignee cannot begin its review, raise points on
it, resolve points, or approve it - at any grade, including Administrator. This
is the one rule with no override, because an override would defeat its purpose.

**2. An Associate cannot review.**
Rejected when the deliverable is created and again on every edit, so it cannot be
introduced by a later reassignment - and checked once more at the moment somebody
begins a review, returns work for rework or approves it. The second check is not
redundant: grades change. A Senior Associate named as reviewer on twenty live jobs and
later moved down to Associate keeps their name on all twenty, and nothing revisits those
assignments. Without the check at the point of action they could still sign the work off.

**3. Mandatory procedures must be complete before submission.**
Template checklist steps marked mandatory block `submit` and `resubmit` until
ticked. Only a Manager or above can delete a mandatory step.

**4. Rework requires review points.**
Returning a deliverable without raising at least one point is refused - a bare
"redo this" gives the preparer nothing to act on.

**5. Every must-fix point must be answered before resubmission.**
The preparer has to record what they did about each one. Observations and
should-fix points do not block.

**6. Every must-fix point must be disposed of before approval.**
A reviewer must explicitly resolve or waive each one; waiving requires a reason.
An answered-but-unreviewed point still blocks sign-off.

**7. Only a Manager or above closes; only a Partner reopens.**

**8. Closed files are read-only.** Reopening is a recorded, Partner-grade act.

**9. The audit trail is append-only.** No API path updates or deletes
`task_events`. Every transition, review point and document link is recorded with
actor and timestamp.

---

## Review points

A review point is one itemised finding, numbered per round (`R2.3` is the third
point of the second round). Each carries:

- **Severity** - Must fix (blocks approval), Should fix, or Observation
- **Reference** - the working paper, schedule or line item at issue
- **Status** - `open` → `addressed` → `resolved` or `waived`

The reviewer raises points while the deliverable is under review. The preparer
responds to each. The reviewer then resolves or waives them. Only the reviewer
who raised a point may edit or withdraw it, and only before it has been answered.

This is what makes "rectification of review comments and resubmission" a tracked
process with a completion state, rather than a thread of comments someone has to
read and interpret.

---

## Recurring work and job templates

A **job template** holds the standard procedures for a recurring compliance job
plus its statutory deadline rule. Fourteen are seeded, covering VAT, PAYE,
withholding tax, corporate tax instalments and returns, transfer pricing,
statutory audit, financial statements, management accounts, payroll, registrar
annual returns, regulatory returns, tax health checks and client onboarding.

A deadline rule is `{ month_offset, day }` applied to the **end of the period
being reported on**: `{ month_offset: 1, day: 15 }` against a period ending
31 March gives 15 April. The internal target is set `internal_lead_days` earlier,
so the firm has slack before the statutory date. The seeded values are sensible
defaults, not legal advice - **check each one against your jurisdiction's current
rules** and edit the template. No code change is needed.

Two ways work gets scheduled:

- **Bulk generation.** Pick a template, tick a set of clients, give the first
  period end and a number of periods. The system lays out the whole filing
  calendar with deadlines computed per period. Re-running it skips periods that
  already exist, so a partial run is safe to repeat.
- **Roll-forward on closure.** Closing a deliverable with a recurrence creates
  the next period automatically - dates advanced, checklist copied and reset,
  same preparer and reviewer. It will not create a period that already exists.

The period label names the period covered, not the filing month: a March VAT
return filed in April is still `Mar 2026`.

---

## What "overdue" means

One definition, used identically by the dashboard, the deliverables list, the
client screens and every report: the earlier of the internal target and the
statutory deadline has passed, **and** the deliverable is not yet approved,
closed or cancelled. Approved work is no longer chasing, so it stops counting as
overdue even if the date has gone by.

It is defined once, in [`worker/routes/task-sql.ts`](../worker/routes/task-sql.ts).

---

## Who sees whose work

Below **Manager** grade, a person sees the work that is theirs. At and above it,
they see the practice. That threshold is deliberately the same grade that already
decides who may assign a deliverable, allocate a client or close a job - two
different answers to "who runs the practice" would be one too many.

| | What they see |
| --- | --- |
| Deliverables | Ones they prepare or review |
| Clients | Ones they hold an allocation on, are the named partner or manager for, or have a deliverable for |
| Engagements | Those clients' engagements, and only if the firm has opened the area at all |

"Working on it" is what makes the client rule usable: most staff meet a client by
being handed a return for it, and without that arm they could open the deliverable
but not the file it belongs to. A **declined or ended allocation is not a way in** -
somebody who exercised clause 8.2 to refuse a client should not keep a window into
it.

**Engagements are closed to staff by default**, because an engagement says what a
client agreed to pay and for what. The floor stays at Associate, so a firm that
wants its staff to see the scope they are working to can open it under Portal
settings → Who sees what; opened, it is still scoped to the clients they reach.

This is not the same thing as [`shared/visibility.ts`](../shared/visibility.ts),
and the two compose. Visibility answers "may this grade open the Clients screen at
all", which is the firm's to set. Scoping answers "once they are on it, whose
clients are those", which is not - showing an Associate a client they have nothing
to do with is a confidentiality question, not a preference.

The predicates live in
[`worker/routes/task-sql.ts`](../worker/routes/task-sql.ts) beside
`OVERDUE_PREDICATE`, for the same reason: the list, the detail, the counts, the
dashboard and the search all have to agree. Each carries its own bind values
rather than being a bare string - these predicates name the same id several times,
and SQLite numbers a bare `?` one higher than the largest assigned so far in
textual order, so a `?1` written inside a predicate appended after the caller's
filters would silently read the caller's *first* filter value as the user id.

**Detail endpoints are scoped too.** A list that filters beside a detail endpoint
that does not is not a permission, it is a decoration: the id is in the URL of
every link anybody was ever sent. "Does not exist, or is not one of yours" is one
sentence on purpose - separating them would turn the endpoint into a way of asking
whether a given id exists, which over enough guesses is a map of the firm's client
work.

---

## Allocating a client, and the right to decline

The Associate Consultant Agreement is built around the **Assigned Client**: the
fee is per assigned client per month, the onboarding obligations are per assigned
client, and Schedule 3 lists the clients assigned at the commencement date. The
system had no such concept - a client had a partner and a manager, and that was
all - so the central unit of the agreement existed only on paper.

It also had no way to satisfy clause 8.2:

> The Associate may decline the allocation of a further client where acceptance
> would, in the Associate's reasonable professional judgement, prejudice the
> proper performance of the Services in respect of an existing Assigned Client. A
> refusal on that ground shall not constitute a breach of this Agreement.

A contractual right that can only be exercised by email is a right in name. Three
things had to be true of it in the system for it to be worth anything.

**An allocation is an offer, not a fact.** Setting a column outright would leave
nothing to decline. An allocation starts as `offered` and becomes real only when
the person accepts it. Until then the client is not theirs and no fee runs.

**Accepting and declining belong to the person it was offered to.** Not to their
manager, not to a partner, not to an administrator. Grade is not a way round
this: a partner accepting a client on an Associate's behalf would put the
judgement the clause protects in the firm's hands. The firm may withdraw an offer
before it is answered, and may reallocate a held client away - which starts the
handover period the agreement requires - but it cannot answer for anybody.

**The grounds are named, not typed.** Somebody exercising clause 8.2 should not
have to know it is clause 8.2, and the firm should not have to read a paragraph
of prose and decide afterwards which right was being used. Three grounds:

| Ground | Counts against them |
| --- | --- |
| It would prejudice a client I already hold | **No** - clause 8.2 |
| A conflict of interest or independence problem | **No** |
| Another reason | Yes - and a reason is required |

The consequence is stated **before** the person answers, not after: whether a
refusal counts against them is the whole reason the right is usable, and somebody
deciding whether to use it needs to read it at that moment. A reason is optional
on the protected grounds and required on the third - demanding a justification
for exercising a right the agreement gives unconditionally would put a condition
on it the agreement does not.

Both answers carry the same visual weight. A screen that makes Accept the obvious
button and leaves Decline to be found tells the reader which answer is expected,
which is what the clause exists to prevent.

Declines are kept and shown with their ground rather than tidied away. The ground
is the point: a refusal listed as a bare "declined", in a system that cannot tell
the grounds apart, turns a right into a mark on a record. History survives a
re-offer, so somebody who declined a client in March and was offered it again in
September has two rows - the first is evidence a right was exercised, the second
that it was not held against them. Only one may be live at a time.

The tier recorded against an allocation is what prices it under Schedule 2 of the
agreement, and a test checks each tier's fee is a placeholder the contract
actually contains.

Defined in [`shared/allocations.ts`](../shared/allocations.ts).

---

## Status reports

Everybody carrying client work writes one short report per reporting day -
**Wednesdays and Fridays** by default, changed in Portal settings → Contract
terms and reporting, or switched off entirely.

**One report per person, not one per deliverable.** Somebody carrying nine open
jobs would otherwise write nine reports twice a week, which is how a reporting
requirement becomes a ritual everybody satisfies and nobody reads. A report is a
narrative, an optional list of what is in the person's way, and any number of
their own deliverables named as references, each with an optional line of its
own.

**A report belongs to a reporting day, not to the day it was written.** A
Wednesday report handed in on Thursday is still Wednesday's report; recording it
against Thursday would destroy the only evidence that it was late. The reporting
day is derived from the calendar on the server rather than sent by the client,
which is also why a report cannot be filed against a deadline that has not
arrived yet.

**A period is bounded by the previous reporting day, not by a fixed number of
hours.** With Wednesday and Friday: Friday's report covers Thursday and Friday;
Wednesday's covers Saturday through Wednesday. The obvious implementation of
"every 48 hours" would leave Saturday, Sunday and Monday in no report at all.
A test walks a full calendar year and asserts that every day falls in exactly one
report.

**A second submission amends the first**, until the next reporting day comes
round. Two reports covering the same days, disagreeing, with nothing saying
which was meant, is worse than one that was corrected. After that it is fixed:
an account of a week that can be rewritten a month later is not an account of
anything.

Referenced deliverables must be assigned to the writer, checked on the server as
well as filtered in the picker - a report naming somebody else's job reads as a
claim about work the writer did not do. A deliverable already named in a report
stays listed even after it is approved or closed, so amending a report cannot
silently drop something the person said.

**Who reads them.** The writer, their line manager, anybody reviewing their work,
and HR administrators. A peer at the same grade is deliberately excluded: a
report written knowing the whole office reads it stops being an account of the
week. Supervisors also get the other half of the answer - who owes a report and
has not filed one - which cannot be got by reading what arrived.

Nobody is asked for a report covering time before they arrived, and the
outstanding count looks back 28 days: "two" or "several" is what a manager acts
on, and counting back through a whole employment to report 143 would be true,
useless, and a table scan on every sidebar draw.

Defined in [`shared/status-reports.ts`](../shared/status-reports.ts), shared by
the Worker and the browser.

---

## Reports

- **Work in progress by stage** - where the portfolio sits right now.
- **Workload by person** - open items, overdue items, items in review, and budget
  against logged hours.
- **Service line summary** - volume and overdue exposure per service line.
- **Review quality by preparer** - review rounds, how many came back, must-fix
  points answered, and a first-pass rate (the share of a preparer's reviewed
  deliverables never returned for rework).

A word on the first-pass rate: it is a conversation starter, not a performance
score. A low rate on complex work under a tight budget means something quite
different from a low rate on routine filings. The screen says so too.
