# The practice workflow

This describes how a client deliverable moves from assignment to closure, and
which controls the system enforces rather than merely suggests.

The model follows the prepare / review / clear-points / sign-off cycle used in
accounting, tax and regulatory compliance practices — the same shape found in
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
  reviewer, and the system refuses the assignment outright.
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
| **Awaiting client**     | Preparer      | Blocked on client information — the clock is paused   |
| **On hold**             | Preparer      | Suspended for an internal reason                      |
| **Submitted for review**| Reviewer      | Handed over, not yet picked up                        |
| **Under review**        | Reviewer      | Review round open; points being raised                |
| **Rework required**     | Preparer      | Points issued; corrections needed                     |
| **Approved**            | Supervisor    | Signed off, awaiting delivery and closure             |
| **Closed**              | —             | Delivered and filed. Read-only.                       |
| **Cancelled**           | —             | Abandoned, but retained for audit                     |

---

## The controls that actually bite

These are enforced server-side. The UI disables the corresponding button and
explains why, but removing the button is not what stops it.

**1. Nobody reviews their own work.**
Whoever is the deliverable's assignee cannot begin its review, raise points on
it, resolve points, or approve it — at any grade, including Administrator. This
is the one rule with no override, because an override would defeat its purpose.

**2. An Associate cannot be named reviewer.**
Rejected when the deliverable is created and again on every edit, so it cannot be
introduced by a later reassignment.

**3. Mandatory procedures must be complete before submission.**
Template checklist steps marked mandatory block `submit` and `resubmit` until
ticked. Only a Manager or above can delete a mandatory step.

**4. Rework requires review points.**
Returning a deliverable without raising at least one point is refused — a bare
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

- **Severity** — Must fix (blocks approval), Should fix, or Observation
- **Reference** — the working paper, schedule or line item at issue
- **Status** — `open` → `addressed` → `resolved` or `waived`

The reviewer raises points while the deliverable is under review. The preparer
responds to each. The reviewer then resolves or waives them. Only the reviewer
who raised a point may edit or withdraw it, and only before it has been answered.

This is what makes "rectification of review comments and resubmission" a tracked
process with a completion state, rather than a thread of comments someone has to
read and interpret.

---

## Recurring work and job templates

A **job template** holds the standard procedures for a recurring compliance job
plus its statutory deadline rule. Fifteen are seeded, covering VAT, PAYE,
withholding tax, corporate tax instalments and returns, transfer pricing,
statutory audit, financial statements, management accounts, payroll, registrar
annual returns, regulatory returns, tax health checks and client onboarding.

A deadline rule is `{ month_offset, day }` applied to the **end of the period
being reported on**: `{ month_offset: 1, day: 15 }` against a period ending
31 March gives 15 April. The internal target is set `internal_lead_days` earlier,
so the firm has slack before the statutory date. The seeded values are sensible
defaults, not legal advice — **check each one against your jurisdiction's current
rules** and edit the template. No code change is needed.

Two ways work gets scheduled:

- **Bulk generation.** Pick a template, tick a set of clients, give the first
  period end and a number of periods. The system lays out the whole filing
  calendar with deadlines computed per period. Re-running it skips periods that
  already exist, so a partial run is safe to repeat.
- **Roll-forward on closure.** Closing a deliverable with a recurrence creates
  the next period automatically — dates advanced, checklist copied and reset,
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

## Reports

- **Work in progress by stage** — where the portfolio sits right now.
- **Workload by person** — open items, overdue items, items in review, and budget
  against logged hours.
- **Service line summary** — volume and overdue exposure per service line.
- **Review quality by preparer** — review rounds, how many came back, must-fix
  points answered, and a first-pass rate (the share of a preparer's reviewed
  deliverables never returned for rework).

A word on the first-pass rate: it is a conversation starter, not a performance
score. A low rate on complex work under a tight budget means something quite
different from a low rate on routine filings. The screen says so too.
