# Kesmic Practice Manager

An employee portal for an accounting, tax and regulatory services practice.
Staff are onboarded through it — contract read and signed on the portal, welcome
message from the Managing Director, the employee handbook acknowledged policy by
policy, HR records maintained — and it is also where client work is managed:
deliverables created with timelines, assigned to associates, submitted for
review, returned with itemised review points, rectified, resubmitted, approved
and closed.

The controls a professional practice needs are enforced on the server rather than
suggested by the interface.

Built for [Kesmic Consulting](https://www.kesmic.org).

---

## The employee portal

**Onboarding** — a new joiner signs in and lands on a page with a progress bar,
the welcome message from the MD, the documents they owe a response to, what
personal details are still missing, their own steps, and the steps the firm owes
them.

**Contracts signed on the portal** — the employee reads the document, ticks an
explicit attestation and types their full name. The system requires the typed
name to match their account, waits until they have scrolled to the end, and
records the timestamp, IP address and a SHA-256 hash of the exact text agreed to.

**The employee handbook** — ten seeded policies covering conduct and ethics,
client confidentiality, independence and conflicts, anti-money laundering, IT
security, leave, working hours, dignity at work, performance, and grievance and
disciplinary procedure. Each is acknowledged separately. **Amending a published
policy raises its version and asks everyone to acknowledge it again**, while the
earlier signatures survive as a record of what was agreed before.

**HR records** — employment details, personal and emergency contact information,
qualifications, pay and bank details, and a personnel file of documents. Access is
layered: personal details are visible to the employee and HR administrators only
(**not** to a line manager), and pay details only at partner grade.

Details in **[docs/PORTAL.md](docs/PORTAL.md)**.

---

## Client work

**Client and engagement records** — entity type, tax and registration numbers,
financial year end, risk rating, engagement partner and manager, and engagements
that group deliverables under a signed letter, a fee and a budget.

**Deliverables with a real review cycle** — separate internal target and
statutory deadline dates, procedure checklists, priorities, budget hours, and a
status lifecycle that runs from draft through review rounds to closure.

**Review points** — a reviewer raises itemised findings, each with a severity, a
reference to the working paper at issue, and a status. The preparer answers each
one; the reviewer resolves or waives it. A deliverable cannot be signed off with
a must-fix point outstanding.

**Job templates and a filing calendar** — fifteen seeded compliance templates
(VAT, PAYE, withholding tax, corporate tax, transfer pricing, statutory audit,
management accounts, payroll, registrar and regulatory returns, and more), each
with its standard procedures and a statutory deadline rule. Generate a whole
year's filings across many clients in one step; recurring jobs roll forward
automatically when closed.

**Time recording, document links, discussion and an append-only audit trail** on
every deliverable.

**Dashboards and practice reports** — personal work queues, overdue exposure,
workload by person, service line summaries, and review quality by preparer.

The workflow, the grades and the controls are documented in
**[docs/WORKFLOW.md](docs/WORKFLOW.md)**.

---

## Controls worth knowing about

- **Nobody reviews their own work.** No override exists, at any grade.
- **Associates cannot be named reviewer** — reviewing needs Senior Associate grade.
- **Mandatory procedures block submission** until they are complete.
- **Rework requires at least one review point**, so the preparer knows what to fix.
- **Must-fix points must be answered before resubmission** and explicitly
  resolved or waived before approval.
- **Manager grade closes files; only a Partner reopens one.**
- **Temporary passwords are confined** to onboarding and the account screen until
  changed — they cannot be used to reach client work.
- **An employee cannot change their own job title, grade or pay.**
- **A line manager cannot see their reports' home address or date of birth.**
- **Pay details are partner-only**, and are kept in their own table so no ordinary
  query can reach them.
- **Amending a published policy resets consent** rather than inheriting it.
- **Both audit trails are append-only** — no endpoint updates or deletes
  `task_events` or `hr_events`.

---

## Architecture

One Cloudflare Worker serves the React app and the API from a single origin,
backed by Cloudflare D1 (SQLite).

```
shared/workflow.ts   the deliverable state machine, grades and gates — the single
                     source of truth, imported by BOTH the Worker and the React app
shared/hr.ts         portal domain: access thresholds, document rules, the
                     onboarding programme — likewise shared by both sides
shared/types.ts      wire types shared across the boundary

worker/              the API
  index.ts           router; /api/* handled here, everything else is a static asset
  auth.ts            PBKDF2 passwords (work factor bounded by the Worker CPU
                     budget, optional pepper), database-backed sessions
  dates.ts           statutory deadline and recurrence arithmetic
  routes/            auth, users, clients, engagements, tasks, workflow,
                     reviews, task-items, templates, insights,
                     employees, documents, settings

src/                 the React app (TypeScript, Vite, Tailwind)
  lib/               API client, session context, formatting
  components/        layout and shared UI
  pages/             dashboard, deliverables, task detail, clients, engagements,
                     templates, reports, team, inbox, account,
                     onboarding, handbook, document view, my details,
                     people, employee file, portal admin

migrations/          D1 schema, seeded job templates and seeded handbook,
                     applied by CI
docs/                deployment, workflow and portal documentation
```

Because both sides import `shared/workflow.ts`, a button appears in the UI
exactly when the server would permit the action, and the reason a blocked action
is blocked is the same sentence in both places.

Same-origin means no CORS layer and session cookies that stay `SameSite=Lax`.

---

## Getting it running

**If you are not a developer**, follow
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** instead of anything below. It is a
click-by-click guide you can complete entirely in a web browser — no software to
install and nothing to type into a terminal. GitHub does the building and
publishing; you only paste three codes between two websites.

The rest of this section is the equivalent for someone comfortable at a command
line:

```bash
npm install
npx wrangler login
npx wrangler d1 create kesmic-practice     # paste the id into wrangler.toml
npx wrangler secret put BOOTSTRAP_SECRET   # a long random string
npm run build
npx wrangler d1 migrations apply kesmic-practice --remote
npx wrangler deploy
```

Then open `/setup` on the deployed URL to create the first administrator.

Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository
secrets, and every push to `main` builds, migrates and deploys itself.

### Local development

```bash
echo 'BOOTSTRAP_SECRET=local-dev-secret' > .dev.vars
npx wrangler d1 migrations apply kesmic-practice --local
npm run build && npx wrangler dev          # http://127.0.0.1:8787
```

`npm run dev` runs Vite alone for fast UI iteration, but the API needs
`wrangler dev`, so use the command above when working on anything end to end.

---

## Scripts

| Command                     | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `npm run typecheck`         | TypeScript across app, Worker and shared code  |
| `npm run build`             | Typecheck, then build the app into `dist/`     |
| `npx wrangler dev`          | Run the whole system locally                   |
| `npm run db:migrate:local`  | Apply migrations to the local database         |
| `npm run db:migrate:remote` | Apply migrations to production                 |
| `npm run deploy`            | Deploy by hand (CI normally does this)         |

---

## Before you rely on it

- **Have the handbook reviewed before publishing it.** The seeded policies are
  drafting starting points, not finished legal instruments. They ship as **drafts**
  for that reason — review each against the employment law and professional
  standards that apply to the firm, then publish. Nothing reaches staff until you
  do.
- **Check whether typed-name signatures satisfy your jurisdiction** for
  employment contracts. The captured record is strong evidence of agreement, but
  whether it is a valid signature is a legal question, not a technical one.
- **Check the statutory deadlines.** The seeded job templates carry sensible
  default filing deadlines, but tax and filing dates are jurisdiction-specific and
  change. Review every template in **Job templates** against the rules that apply
  to you and edit the dates. No code change is needed.
- **Take backups.** `npx wrangler d1 export kesmic-practice --remote --output backup.sql`
  on a schedule. Client compliance records deserve a copy outside Cloudflare.
- **Clear the bootstrap secret** once the first administrator exists:
  `npx wrangler secret delete BOOTSTRAP_SECRET`. That disables `/setup`.
- **Understand the password work factor.** It is capped by the Worker CPU budget,
  not by cryptography: the Free plan allows 10 ms of CPU per request, and
  PBKDF2-SHA256 costs ~0.5 ms per thousand iterations, so the default is 8,000
  (~4 ms) rather than the 600,000 OWASP recommends (~290 ms). Exceeding the budget
  does not degrade gracefully — Cloudflare kills the request, so authentication
  fails outright. On the Paid plan, set `PASSWORD_ITERATIONS = "600000"` and
  `[limits] cpu_ms` (both are written and commented in `wrangler.toml`). Every
  hash records its own iteration count, so changing the setting never invalidates
  a stored password.
- **Set `PASSWORD_PEPPER` if you stay on the Free plan.** It is HMAC'd into each
  password before the KDF and lives in Worker secrets rather than D1, so a leaked
  database export cannot be attacked offline whatever the work factor — which is
  what makes a reduced iteration count defensible. Hashes record whether they were
  peppered, so it can be switched on later without locking anyone out; it can
  never be changed or removed afterwards, and the API says so explicitly rather
  than reporting a wrong password.
- **Documents are linked, not stored.** Deliverables and personnel files hold
  links into your existing document store rather than file uploads. Cloudflare R2
  would be the natural place to add real uploads later.
- **Notifications are in-app only.** There is an inbox with unread counts, but no
  email is sent. Email would need a provider (Resend, Postmark, MailChannels)
  wired into the notification writes in `worker/db.ts`.
