# Kesmic Practice Manager

An employee portal for an accounting, tax and regulatory services practice.
Staff are onboarded through it - contract read and signed on the portal, welcome
message from the Managing Director, the employee handbook acknowledged policy by
policy, HR records maintained - and it is also where client work is managed:
deliverables created with timelines, assigned to associates, submitted for
review, returned with itemised review points, rectified, resubmitted, approved
and closed.

The controls a professional practice needs are enforced on the server rather than
suggested by the interface.

Built for [Kesmic Consulting](https://www.kesmic.org).

---

## The employee portal

**Onboarding** - a new joiner signs in and lands on a page with a progress bar,
the welcome message from the MD, the documents they owe a response to, what
personal details are still missing, their own steps, and the steps the firm owes
them.

**Two contract templates** - a contract of employment, and an Associate Consultant
Agreement for independent professionals engaged on a contract *for* service, paid a
fixed fee per assigned client rather than a salary. Each is copied per person,
completed, and issued to them alone. Both ship as drafts to be reviewed before use,
and the Associate template carries its own notes on what the firm must change about
its onboarding before putting a contractor through it.

**Contracts signed on the portal** - the employee reads the document, ticks an
explicit attestation and types their full name. The system requires the typed
name to match their account, waits until they have scrolled to the end, and
records the timestamp, IP address and a SHA-256 hash of the exact text agreed to.

**The employee handbook** - ten seeded policies covering conduct and ethics,
client confidentiality, independence and conflicts, anti-money laundering, IT
security, leave, working hours, dignity at work, performance, and grievance and
disciplinary procedure. Each is acknowledged separately. **Amending a published
policy raises its version and asks everyone to acknowledge it again**, while the
earlier signatures survive as a record of what was agreed before.

**HR records** - employment details, personal and emergency contact information,
qualifications, pay and bank details, and a personnel file of documents. Access is
layered: personal details are visible to the employee and HR administrators only
(**not** to a line manager), and pay details only at partner grade.

Details in **[docs/PORTAL.md](docs/PORTAL.md)**.

---

## Client work

**Client and engagement records** - entity type, tax and registration numbers,
financial year end, risk rating, engagement partner and manager, and engagements
that group deliverables under a signed letter, a fee and a budget. An engagement
covers as many service lines as the letter does: one subscription engagement can
be bookkeeping, payroll and tax compliance at once, and the service-line filter
finds it under any of them.

**Two public intake links** - one for prospective clients, one for existing clients
asking for more work. Each is a single unguessable address the firm copies onto its
website or into an email; submissions arrive in a queue with the whole firm's
supervisors notified. Accepting a new-client enquiry creates the client record from
what was submitted, as a prospect. Nothing is confirmed to the sender, so the form
cannot be used to ask whether a given company is a client, and no record other than
the request itself is created until a person accepts it.

**Deliverables with a real review cycle** - separate internal target and
statutory deadline dates, procedure checklists, priorities, budget hours, and a
status lifecycle that runs from draft through review rounds to closure.

**Review points** - a reviewer raises itemised findings, each with a severity, a
reference to the working paper at issue, and a status. The preparer answers each
one; the reviewer resolves or waives it. A deliverable cannot be signed off with
a must-fix point outstanding.

**Job templates and a filing calendar** - fourteen seeded compliance templates
(VAT, PAYE, withholding tax, corporate tax, transfer pricing, statutory audit,
management accounts, payroll, registrar and regulatory returns, and more), each
with its standard procedures and a statutory deadline rule. Generate a whole
year's filings across many clients in one step; recurring jobs roll forward
automatically when closed.

**Time recording, document links, discussion and an append-only audit trail** on
every deliverable.

**The client file** - an index of each client's folders and documents as links into
SharePoint, OneDrive or Google Drive, with the provider recognised from the address.
The portal stores no document content, grants no access, and never fetches a link:
following one means signing in to Microsoft or Google as yourself. What the portal adds
is the answer to "where is it", which is what was actually missing.

**Dashboards and practice reports** - personal work queues, overdue exposure,
workload by person, service line summaries, and review quality by preparer.

The workflow, the grades and the controls are documented in
**[docs/WORKFLOW.md](docs/WORKFLOW.md)**.

---

## Controls worth knowing about

- **Nobody reviews their own work.** No override exists, at any grade.
- **Sign-in attempts are limited.** Ten failures against one account, or fifty from one
  address, and the portal stops answering for fifteen minutes. Counted before the
  password is hashed, and cleared as soon as somebody signs in successfully.
- **A status change cannot be applied twice.** Every transition is written on condition
  that the deliverable is still in the status the decision was made against, so two
  overlapping requests cannot both take effect.
- **No client document is ever stored in the portal.** The client file holds links
  only, and the Worker never fetches one: a Worker retrieving an address an employee
  typed would make the firm's own infrastructure issue requests on someone else's
  behalf. Links are restricted to http and https, so a client file cannot be used to
  run something in a colleague's session.
- **An intake submission creates nothing but itself.** A client record appears only
  when a Manager accepts the request, and an existing-client request has to be
  matched to a file by hand - the portal will not guess from a typed name.
- **Associates cannot be named reviewer**, and cannot review even where they already
  are named. Reviewing needs Senior Associate grade both when the reviewer is chosen and
  again at the moment they act, so somebody moved down a grade stops being able to sign
  off the deliverables their name is still on.
- **Mandatory procedures block submission** until they are complete.
- **Rework requires at least one review point**, so the preparer knows what to fix.
- **Must-fix points must be answered before resubmission** and explicitly
  resolved or waived before approval.
- **Manager grade closes files; only a Partner reopens one.**
- **Temporary passwords are confined** to onboarding and the account screen until
  changed - they cannot be used to reach client work.
- **An employee cannot change their own job title, grade or pay.**
- **A line manager cannot see their reports' home address or date of birth.**
- **Pay details are partner-only**, and are kept in their own table so no ordinary
  query can reach them.
- **Amending a published policy resets consent** rather than inheriting it.
- **Both audit trails are append-only** - no endpoint updates or deletes
  `task_events` or `hr_events`.

---

## Architecture

One Worker serves the React app and the API from a single origin, backed by
Cloudflare D1 (SQLite). It is deployed as a **Cloudflare Pages** project in
advanced mode: `worker/index.ts` is bundled to `dist/_worker.js`, which Pages
hands every request to.

Pages rather than Workers only because of the custom domain. `portal.kesmic.org`
has to be pointed at this from Wix's DNS, and Wix does not let a domain
registered with it use anyone else's nameservers - which a Worker custom domain
requires. Pages accepts a CNAME from external DNS. See
**[docs/DOMAIN.md](docs/DOMAIN.md)**.

```
shared/workflow.ts   the deliverable state machine, grades and gates - the single
                     source of truth, imported by BOTH the Worker and the React app
shared/hr.ts         portal domain: access thresholds, document rules, the
                     onboarding programme - likewise shared by both sides
shared/intake.ts     client intake: the two links, request states, the field
                     limits the public form and the server both enforce
shared/files.ts      the client file: providers recognised from a link, what
                     counts as a safe link, how a file is grouped
shared/login-policy.ts
                     how many sign-in attempts, over how long, and why those numbers
shared/types.ts      wire types shared across the boundary

worker/              the API
  index.ts           router; /api/* handled here, everything else is a static asset
  auth.ts            PBKDF2 passwords (work factor bounded by the Worker CPU
                     budget, optional pepper), database-backed sessions
  throttle.ts        the sign-in attempt limit, counted in D1
  dates.ts           statutory deadline and recurrence arithmetic
  routes/            auth, users, clients, client-files, engagements, tasks,
                     workflow, reviews, task-items, templates, insights, intake,
                     employees, documents, settings

src/                 the React app (TypeScript, Vite, Tailwind)
  lib/               API client, session context, formatting
  components/        layout and shared UI
  pages/             dashboard, deliverables, task detail, clients, engagements,
                     client requests, the two public intake forms,
                     templates, reports, team, inbox, account,
                     onboarding, handbook, document view, my details,
                     people, employee file, portal admin

migrations/          D1 schema, seeded job templates and seeded handbook,
                     applied by CI
tests/               the workflow engine, the sign-in limit and the deadline
                     arithmetic - the parts where being wrong is a control failure
                     rather than a broken screen
scripts/             build-worker.mjs - bundles the Worker to dist/_worker.js
                     run-tests.mjs    - bundles tests/ and runs node --test
docs/                user guide, deployment, custom domain, email, two-step sign-in,
                     workflow and portal documentation
```

Because both sides import `shared/workflow.ts`, a button appears in the UI
exactly when the server would permit the action, and the reason a blocked action
is blocked is the same sentence in both places.

Same-origin means no CORS layer and session cookies that stay `SameSite=Lax`.

---

## Getting it running

**If you are here to use the portal rather than to work on it**, read
**[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**. It covers every screen and every
grade, for everyone from a new joiner on their first morning to a partner running
the firm's people side.

**If you are not a developer but need to deploy it**, follow
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** instead of anything below. It is a
click-by-click guide you can complete entirely in a web browser - no software to
install and nothing to type into a terminal. GitHub does the building and
publishing; you only paste three codes between two websites.

The rest of this section is the equivalent for someone comfortable at a command
line:

```bash
npm install
npx wrangler login
npx wrangler d1 create kesmic-practice           # paste the id into wrangler.toml
npx wrangler pages project create kesmic-practice-manager --production-branch=main
npx wrangler pages secret put BOOTSTRAP_SECRET   # a long random string
npm run build
npx wrangler d1 migrations apply kesmic-practice --remote
npx wrangler pages deploy --branch=main
```

Then open `/setup` on the deployed URL to create the first administrator.

Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository
secrets, and every push to `main` builds, migrates and deploys itself. The token
needs **Cloudflare Pages: Edit**, **D1: Edit** and **Account Settings: Read** - a
token cut for Workers Scripts instead of Pages will fail at the deploy step.

### Local development

```bash
echo 'BOOTSTRAP_SECRET=local-dev-secret' > .dev.vars
npx wrangler d1 migrations apply kesmic-practice --local
npm run build && npx wrangler pages dev    # http://127.0.0.1:8788
```

`npm run dev` runs Vite alone for fast UI iteration, but the API needs
`wrangler pages dev`, so use the command above when working on anything end to
end. Note that `npm run build` must run first, and again after any change to
`worker/` - `pages dev` serves the bundled `dist/_worker.js`, not the sources.

---

## Scripts

| Command                     | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `npm run typecheck`         | TypeScript across app, Worker and shared code  |
| `npm test`                  | The workflow, sign-in and date-arithmetic tests |
| `npm run build`             | Typecheck, then build the app into `dist/`     |
| `npx wrangler pages dev`    | Run the whole system locally                   |
| `npm run db:migrate:local`  | Apply migrations to the local database         |
| `npm run db:migrate:remote` | Apply migrations to production                 |
| `npm run deploy`            | Deploy by hand (CI normally does this)         |

---

## Before you rely on it

- **Have the handbook reviewed before publishing it.** The seeded policies are
  drafting starting points, not finished legal instruments. They ship as **drafts**
  for that reason - review each against the employment law and professional
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
  `npx wrangler pages secret delete BOOTSTRAP_SECRET`. That disables `/setup`.
- **Understand the password work factor.** It is capped by the Worker CPU budget,
  not by cryptography: the Free plan allows 10 ms of CPU per request, and
  PBKDF2-SHA256 costs ~0.5 ms per thousand iterations, so the default is 8,000
  (~4 ms) rather than the 600,000 OWASP recommends (~290 ms). Exceeding the budget
  does not degrade gracefully - Cloudflare kills the request, so authentication
  fails outright. On the Paid plan, set `PASSWORD_ITERATIONS = "600000"` and
  `[limits] cpu_ms` (both are written and commented in `wrangler.toml`). Every
  hash records its own iteration count, so changing the setting never invalidates
  a stored password. A fast hash is only safe against guessing if the number of guesses
  is capped, which is what the sign-in limit in `shared/login-policy.ts` is for - it
  matters more here than it would on a deployment running at full strength.
- **Set `PASSWORD_PEPPER` if you stay on the Free plan.** It is HMAC'd into each
  password before the KDF and lives in Worker secrets rather than D1, so a leaked
  database export cannot be attacked offline whatever the work factor - which is
  what makes a reduced iteration count defensible. Hashes record whether they were
  peppered, so it can be switched on later without locking anyone out; it can
  never be changed or removed afterwards, and the API says so explicitly rather
  than reporting a wrong password.
- **Documents are linked, not stored.** Deliverables and personnel files hold
  links into your existing document store rather than file uploads. Cloudflare R2
  would be the natural place to add real uploads later.
- **Email notifications are optional and inert until configured.** The in-app inbox
  is always the system of record. Set `EMAIL_API_KEY` and `EMAIL_FROM` and the same
  events also send email, via `worker/email.ts`; with no key nothing is sent and
  nothing fails. `EMAIL_PROVIDER` chooses between Postmark, SendGrid and Resend,
  because the choice is forced by DNS rather than preference: Resend verifies a domain
  by requiring an MX record on a subdomain, which registrars including Wix refuse to
  create, while the other two verify with TXT and CNAME alone. Sending happens in `waitUntil`, so a slow or broken provider cannot
  affect a request, and every failure is logged rather than raised. Setup, including
  the DNS work, is in **[docs/EMAIL.md](docs/EMAIL.md)**.
