# Deployment

The system is one Cloudflare Worker that serves both the React app and the JSON
API, backed by a Cloudflare D1 database. GitHub is the source of truth, and
GitHub Actions deploys on every push to `main`.

```
  git push to main
        │
        ▼
  GitHub Actions ──► npm run build (typecheck + Vite)
        │            wrangler d1 migrations apply --remote
        │            wrangler deploy
        ▼
  Cloudflare Worker ── /api/*  → API handlers ──► D1 (kesmic-practice)
                    └─ /*      → React app (static assets)
```

There is a **one-time manual setup** below. After that you never deploy by hand:
pushing to `main` is the deploy.

---

## Why not GitHub Pages

GitHub Pages serves static files only. This system has to enforce rules that the
browser must not be trusted with — an associate cannot approve their own work, a
deliverable cannot be signed off with unresolved review points. Those checks have
to run on a server, so there has to be a backend somewhere.

Cloudflare Workers is that backend. The code, history and CI all stay on GitHub;
Cloudflare is only the runtime.

---

## Part 1 — One-time Cloudflare setup

### 1.1 Create the database

Install Wrangler locally and sign in once:

```bash
npm install
npx wrangler login          # opens a browser
npx wrangler d1 create kesmic-practice
```

That prints a `database_id`. Paste it into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`, then commit. The id is not a secret.

### 1.2 Set the bootstrap secret

This authorises creation of the very first administrator account, once.

```bash
npx wrangler secret put BOOTSTRAP_SECRET
# paste a long random string and keep it somewhere safe
```

Generate one with `openssl rand -base64 32`.

### 1.3 First deploy

```bash
npm run build
npx wrangler d1 migrations apply kesmic-practice --remote
npx wrangler deploy
```

Wrangler prints a `https://kesmic-practice-manager.<subdomain>.workers.dev` URL.
Open it, go to `/setup`, and create your administrator account using the
bootstrap secret. The endpoint refuses to run again once a user exists.

### 1.4 Hand the deploys to GitHub Actions

Create a Cloudflare API token at
**Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token**
with these permissions:

| Scope   | Permission           | Access |
| ------- | -------------------- | ------ |
| Account | Workers Scripts      | Edit   |
| Account | D1                   | Edit   |
| Account | Account Settings     | Read   |

Then add two **repository secrets** in GitHub
(**Settings → Secrets and variables → Actions → New repository secret**):

| Name                    | Value                                              |
| ----------------------- | -------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | the token you just created                         |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID |

From here on, every push to `main` builds, migrates and deploys by itself.

---

## Part 2 — Putting it on your domain

You own `kesmic.org` through Wix. The goal is
`https://tasks.kesmic.org` pointing at the Worker, with `www.kesmic.org`
continuing to serve your existing Wix site.

Pick one of the two options below. **Option A** is the one I recommend.

### Option A (recommended) — move DNS for kesmic.org to Cloudflare

Cloudflare Worker custom domains require the domain's DNS to be hosted at
Cloudflare. Moving it also puts Cloudflare's CDN and certificates in front of
your Wix site, which is a bonus rather than a cost.

**Before you change anything, record your current DNS.** In the Wix dashboard
open **Domains → kesmic.org → DNS Records** and screenshot or copy every record
(A, CNAME, MX, TXT). You will verify these afterwards. The records that matter
most are the ones pointing `kesmic.org` and `www.kesmic.org` at Wix, plus any
`MX` records for email and `TXT` records for SPF/DKIM or domain verification.

1. Create a free Cloudflare account and choose **Add a site** → `kesmic.org`.
2. Cloudflare scans your existing DNS and imports what it finds. **Check the
   imported list against what you recorded** and add anything missing —
   especially `MX` and `TXT` records. Getting this wrong is the one step that can
   take your website or email offline.
3. Cloudflare gives you two nameservers, e.g. `xxx.ns.cloudflare.com`.
4. In Wix: **Domains → kesmic.org → Advanced → Change nameservers**, and set
   Wix to use external nameservers, entering Cloudflare's two.
5. Wait for Cloudflare to report the domain **Active** (usually well under an
   hour, occasionally up to 24). Confirm `www.kesmic.org` still loads your Wix
   site before continuing.
6. Attach the subdomain to the Worker — **Workers & Pages →
   kesmic-practice-manager → Settings → Domains & Routes → Add → Custom
   domain** → `tasks.kesmic.org`. Cloudflare creates the DNS record and issues
   the TLS certificate automatically.

`https://tasks.kesmic.org` is now the system, and it stays on that URL through
every future deploy.

### Option B — leave DNS at Wix

If you would rather not move the apex domain, run on the free hostname
Cloudflare already gave you:

```
https://kesmic-practice-manager.<your-subdomain>.workers.dev
```

Everything works identically — it is the same Worker — the URL is just not
branded. This needs no DNS changes at all. You can switch to Option A whenever
you like without touching the code.

> There is a third route: delegating only `tasks.kesmic.org` to Cloudflare with
> `NS` records at Wix, leaving the apex on Wix DNS. Cloudflare supports
> subdomain-only zones, but availability varies by plan, so confirm it is offered
> on your account before relying on it.

---

## Part 3 — Adding your team

Sign in as the administrator, go to **Team → Add team member**, and set each
person's grade. The system shows a temporary password **once** — pass it on
through a channel separate from the link, for example read it out by phone.

On first sign-in the user must set their own password. Until they do, the API
refuses everything except the account screen, so a temporary password cannot be
used to drive the system.

Grades and what they permit are documented in [WORKFLOW.md](./WORKFLOW.md).

---

## Everyday operations

| Task                          | How                                                    |
| ----------------------------- | ------------------------------------------------------ |
| Ship a change                 | Merge to `main`. Actions deploys it.                   |
| Change the schema             | Add a **new** file in `migrations/`. Never edit an applied one. |
| Roll back                     | Revert the commit and push. Actions redeploys.          |
| Read production logs          | `npx wrangler tail`                                     |
| Query production data         | `npx wrangler d1 execute kesmic-practice --remote --command "SELECT ..."` |
| Back up the database          | `npx wrangler d1 export kesmic-practice --remote --output backup.sql` |
| Run locally                   | See below                                               |

### Running locally

```bash
npm install
echo 'BOOTSTRAP_SECRET=local-dev-secret' > .dev.vars   # gitignored
npx wrangler d1 migrations apply kesmic-practice --local
npm run build
npx wrangler dev
```

That serves the whole system at `http://127.0.0.1:8787` against a local SQLite
database. `.dev.vars` is gitignored and must stay that way.

### Backups

D1 has point-in-time recovery on paid plans. On the free plan, take your own
export on a schedule — the `d1 export` command above is enough, and a monthly
run stored somewhere off Cloudflare is a sensible minimum for client records.

---

## Cost

At the size of a small practice this runs inside Cloudflare's free tier
(100,000 Worker requests/day, 5 GB of D1 storage, 5 million row reads/day).
The Workers Paid plan is $5/month if you outgrow it.

---

## Rules the deployment relies on

- **Migrations are additive.** They run *before* the new Worker goes out, so a
  migration must never break the currently released code. To remove a column,
  ship a release that stops reading it, then drop it in a later migration.
- **`.dev.vars` is never committed.** It holds the bootstrap secret.
- **`BOOTSTRAP_SECRET` can be rotated or cleared** once the first administrator
  exists. Clearing it disables `/setup` entirely, which is worth doing:
  `npx wrangler secret delete BOOTSTRAP_SECRET`.
