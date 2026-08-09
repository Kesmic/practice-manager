# Kesmic Practice Manager

Client task and deliverable management for an accounting, tax and regulatory
services practice. Deliverables are created with timelines, assigned to
associates, submitted for review, returned with itemised review points,
rectified, resubmitted, approved and closed — with the controls a professional
practice needs enforced on the server rather than suggested by the interface.

Built for [Kesmic Consulting](https://www.kesmic.org).

---

## What it does

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
- **Temporary passwords are confined** to the account screen until changed.
- **The audit trail is append-only** — no endpoint updates or deletes it.

---

## Architecture

One Cloudflare Worker serves the React app and the API from a single origin,
backed by Cloudflare D1 (SQLite).

```
shared/workflow.ts   the state machine, grades and gates — the single source of
                     truth, imported by BOTH the Worker and the React app
shared/types.ts      wire types shared across the boundary

worker/              the API
  index.ts           router; /api/* handled here, everything else is a static asset
  auth.ts            PBKDF2 passwords, database-backed sessions
  dates.ts           statutory deadline and recurrence arithmetic
  routes/            auth, users, clients, engagements, tasks, workflow,
                     reviews, task-items, templates, insights

src/                 the React app (TypeScript, Vite, Tailwind)
  lib/               API client, session context, formatting
  components/        layout and shared UI
  pages/             dashboard, deliverables, task detail, clients, engagements,
                     templates, reports, team, inbox, account

migrations/          D1 schema and seeded templates, applied by CI
docs/                deployment and workflow documentation
```

Because both sides import `shared/workflow.ts`, a button appears in the UI
exactly when the server would permit the action, and the reason a blocked action
is blocked is the same sentence in both places.

Same-origin means no CORS layer and session cookies that stay `SameSite=Lax`.

---

## Getting it running

Full instructions, including connecting `tasks.kesmic.org`, are in
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. The short version:

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

- **Check the statutory deadlines.** The seeded templates carry sensible default
  filing deadlines, but tax and filing dates are jurisdiction-specific and change.
  Review every template in **Job templates** against the rules that apply to you
  and edit the dates. No code change is needed.
- **Take backups.** `npx wrangler d1 export kesmic-practice --remote --output backup.sql`
  on a schedule. Client compliance records deserve a copy outside Cloudflare.
- **Clear the bootstrap secret** once the first administrator exists:
  `npx wrangler secret delete BOOTSTRAP_SECRET`. That disables `/setup`.
- **Documents are linked, not stored.** Deliverables hold links into your existing
  document store rather than file uploads. Cloudflare R2 would be the natural
  place to add real uploads later.
- **Notifications are in-app only.** There is an inbox with unread counts, but no
  email is sent. Email would need a provider (Resend, Postmark, MailChannels)
  wired into the notification writes in `worker/db.ts`.
