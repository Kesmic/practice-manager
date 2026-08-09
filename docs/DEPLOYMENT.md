# Putting the portal online

A step-by-step guide you can follow entirely in your web browser. No software to
install, nothing to type into a black screen.

**Roughly 30 minutes.** Most of it is copying a few codes between two websites.

You will use two websites:

- **GitHub** — where the portal's files live: https://github.com/Kesmic/practice-manager
- **Cloudflare** — where the portal will actually run, and where its information
  is stored

The idea: you tell Cloudflare to make an empty filing cabinet, you tell GitHub
where that cabinet is, and then GitHub does all the building and publishing work
for you — now and every time anything changes in future.

---

## Before you start

Create a **free** Cloudflare account if you do not have one:
**https://dash.cloudflare.com/sign-up**

That is the only sign-up needed. There is nothing to pay — a firm of your size
fits comfortably inside the free allowance.

Keep a blank note open. You will collect **three codes** along the way and paste
each one somewhere. That is really all this process is.

---

## Part 1 — Make the filing cabinet (on Cloudflare)

This is where staff records, client work and signed documents will be stored.

1. Sign in at **https://dash.cloudflare.com**
2. In the menu on the left, look for **Storage & Databases**, then click
   **D1 SQL Database**. (Cloudflare occasionally rearranges this menu — if you
   cannot see it, type "D1" into the search box at the top.)
3. Click **Create database**
4. In the name box, type exactly:

   ```
   kesmic-practice
   ```

   **The name must match exactly**, including the hyphen and all lower case. The
   portal looks for a cabinet with this precise name and will not find one that
   is spelled differently.
5. Click **Create**

You will land on a page about your new database. Find **Database ID** — a long
string of letters, numbers and hyphens. Click the copy button next to it.

📋 **Paste it into your note as "Code 1 — Database ID".**

---

## Part 2 — Tell the portal where the cabinet is (on GitHub)

1. Open this link, which takes you straight to the right file:

   **https://github.com/Kesmic/practice-manager/blob/claude/kesmic-task-management-d68vl7/wrangler.toml**

2. Click the **pencil icon** near the top right of the file to edit it
3. Find this line, roughly two thirds of the way down:

   ```
   database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
   ```

4. Select just the words `REPLACE_WITH_YOUR_D1_DATABASE_ID` and replace them with
   **Code 1** from your note. **Keep the quotation marks.** When you are done it
   should look something like:

   ```
   database_id = "a1b2c3d4-5678-90ab-cdef-1234567890ab"
   ```

5. Click the green **Commit changes...** button at the top right
6. Leave the message as it is and click **Commit changes** again

That is not a password, by the way — it is just a label saying which cabinet to
use, so there is no harm in it being saved here.

---

## Part 3 — Let GitHub publish to Cloudflare

Right now the two websites do not know each other. This part introduces them.

### 3a. Create the permission slip on Cloudflare

1. Go to **https://dash.cloudflare.com/profile/api-tokens**
2. Click **Create Token**
3. Scroll to the bottom and click **Get started** next to **Create Custom Token**
4. In **Token name**, type: `GitHub publishing`
5. Under **Permissions** you will see a row of three dropdown boxes. Set the
   first row to:

   | Box 1 | Box 2 | Box 3 |
   | --- | --- | --- |
   | Account | Workers Scripts | Edit |

6. Click **+ Add more** and set the second row to:

   | Box 1 | Box 2 | Box 3 |
   | --- | --- | --- |
   | Account | D1 | Edit |

7. Click **+ Add more** and set the third row to:

   | Box 1 | Box 2 | Box 3 |
   | --- | --- | --- |
   | Account | Account Settings | Read |

8. Click **Continue to summary**, then **Create Token**
9. A long code appears. **Copy it now** — Cloudflare will never show it again.

📋 **Paste it into your note as "Code 2 — Permission slip".**

If you lose it, no harm done: come back and create another one, then use the new
one instead.

### 3b. Find your Cloudflare account number

1. In the Cloudflare menu on the left, click **Compute (Workers)** — or
   **Workers & Pages**, depending on what your dashboard calls it
2. Look for **Account ID** on that page (usually in a panel on the right) and
   copy it

📋 **Paste it into your note as "Code 3 — Account ID".**

### 3c. Hand both codes to GitHub

1. Go to **https://github.com/Kesmic/practice-manager/settings/secrets/actions**
2. Click the green **New repository secret**
3. In **Name**, type exactly: `CLOUDFLARE_API_TOKEN`
4. In **Secret**, paste **Code 2**
5. Click **Add secret**
6. Click **New repository secret** again
7. In **Name**, type exactly: `CLOUDFLARE_ACCOUNT_ID`
8. In **Secret**, paste **Code 3**
9. Click **Add secret**

Both names must be typed exactly as shown — capital letters and underscores
included. GitHub hides these values from now on, including from you, which is
the point.

---

## Part 4 — Publish it

This happens in **two separate stages**: first you create a request to publish,
then you approve it. The approve button does not exist until the request does, so
do these in order.

> **Before you start this part, make sure Part 3 is finished** — both codes handed
> to GitHub. Publishing without them will fail. Harmlessly, but it will fail.

### 4a. Create the request

1. Go to **https://github.com/Kesmic/practice-manager/pulls**
2. **If you already see an open request in the list, skip to 4b** — it may
   already have been created for you.
3. Otherwise click **New pull request**
4. You will see two dropdown boxes side by side near the top. Set them so the
   line reads:

   **base: `main`** ← **compare: `claude/kesmic-task-management-d68vl7`**

   The order matters. If you set them the other way round, GitHub will tell you
   there is nothing to compare.
5. Click the green **Create pull request** button
6. A form appears with a title already filled in. Click the green
   **Create pull request** button again to confirm.

You are now on the request's own page. This is where the approve button lives.

### 4b. Approve it

You are looking at a page with tabs across the top (**Conversation**, **Commits**,
**Files changed**). Stay on **Conversation**.

1. **Scroll to the bottom of that page.** This is the step most people miss — the
   button is below the list of automatic checks, not up at the top.
2. You will see a box. Wait for the checks above it to finish (a minute or two);
   they should show green ticks.
3. Click the green button in that box. It will say **Merge pull request** — or
   possibly **Squash and merge** or **Rebase and merge**, depending on settings.
   **Any of them is fine.** If it has a small dropdown arrow beside it, ignore the
   arrow and click the main part of the button.
4. The button changes to **Confirm merge**. Click that.

The box turns purple and says **Merged**. That is the moment your portal starts
publishing itself.

### 4c. Watch it publish

1. Go to **https://github.com/Kesmic/practice-manager/actions**
2. The top item will have a spinning amber dot. Click it to watch progress.
3. After roughly two minutes the dot turns into a **green tick**. Your portal is
   live.

If it turns into a **red cross** instead, click into it, then send me a
screenshot — I will tell you exactly what to change. A failure here breaks
nothing; it simply means it did not publish yet, and you can try again as many
times as you like.

---

## Part 5 — Find your portal and create your account

### 5a. Get the web address

1. In Cloudflare, go to **Compute (Workers)** (or **Workers & Pages**)
2. Click **kesmic-practice-manager**
3. Near the top you will see an address ending in **.workers.dev**. That is your
   portal. Open it in a new tab.

You will see a sign-in screen. You do not have an account yet — next step.

📋 **Paste the address into your note as "Portal address".**

### 5b. Set a one-time setup password

This stops a stranger claiming the very first account in the minutes before you
do.

1. Think of a long random phrase — at least 20 characters, nothing guessable.
   For example: `purple-cabinet-19-ostrich-clay`
2. In Cloudflare, still on the **kesmic-practice-manager** page, click
   **Settings**
3. Find **Variables and Secrets**, then click **+ Add**
4. Set **Type** to **Secret**
5. In **Variable name**, type exactly: `BOOTSTRAP_SECRET`
6. In **Value**, paste your phrase
7. Click **Deploy** (or **Save**)

📋 **Keep the phrase in your note for the next two minutes.**

### 5c. Create your administrator account

1. Go to your portal address and add `/setup` on the end, for example:
   `https://kesmic-practice-manager.something.workers.dev/setup`
2. Fill in the form:
   - **Bootstrap secret** — the phrase from 5b
   - **Full name** — your name, spelled the way you want it to appear on
     documents you sign
   - **Email** — your work email
   - **Password** — at least 12 characters, mixing capitals, lower case and
     numbers or symbols
3. Click **Create administrator**

You are in. This page will refuse to work a second time, so nobody else can use
it to create an account.

---

## Part 6 — Close the setup door

Now that your account exists, remove the setup phrase so that page is dead for good.

1. In Cloudflare: **kesmic-practice-manager → Settings → Variables and Secrets**
2. Find `BOOTSTRAP_SECRET` and delete it
3. Click **Deploy** (or **Save**)

You can now cross the phrase out of your note.

---

## Part 7 — Before your staff use it

Two things need your judgement. Take your time over them — nothing is visible to
staff until you say so.

### Review the handbook

Sign in and go to **Handbook and welcome**.

Ten policies are waiting there marked **Draft**: conduct and ethics, client
confidentiality, independence and conflicts of interest, anti-money laundering,
IT security, leave, working hours, dignity at work, performance, and grievance
and disciplinary procedure.

**These are starting points, not finished documents.** They were written to be
edited. Read each one and have them checked against Ghanaian employment law and
your professional body's requirements before you publish. Click a policy, then
**Edit** to change the wording.

When a policy is genuinely ready, click **Publish**. Only then does it appear to
staff, and only then are they asked to agree to it. Nothing can go out by
accident.

There is also a **Contract of Employment (template)**. Do not publish that one —
copy it for each new employee, fill in their details, and issue it to them
individually.

### Write your welcome message

**Handbook and welcome → Welcome message and firm details.**

There is a draft there, but it will read far better in your own words. Add your
name so it is signed properly. This is the first thing every new joiner reads.

### Then add your team

**People → Team → Add team member.** Set each person's grade — this decides who
can assign work, who can review it, and who can sign it off.

Each person gets a temporary password, shown **once**. Pass it on by phone or in
person, not in the same email as the link. They must set their own password
before they can do anything else.

### And check the filing deadlines

**Job templates** has fifteen standard jobs — VAT returns, PAYE, corporate tax
and so on — each with a filing deadline built in. Those dates are sensible
defaults, not advice. Check each against current Ghana Revenue Authority rules
and adjust. No technical help needed; just edit the template.

---

## From now on

You never repeat any of this. If anything about the portal changes in future, it
publishes itself within a couple of minutes. You do not have to do anything.

To add staff, clients or work, you simply use the portal.

---

## If something goes wrong

**The Actions page shows a red cross.** Click into it and send me a screenshot.
Nothing is broken — it just did not publish. The usual causes are a mistyped
secret name in Part 3c, a database name that is not exactly `kesmic-practice`,
or the Database ID pasted without its quotation marks.

**It says the token "contains a character that cannot be used".** Copying a long
code out of a web page sometimes drags an invisible character along with it — you
cannot see it, and it is nobody's fault. The publish step now strips those
characters automatically, so this should not recur. If it somehow does, go back
to **https://dash.cloudflare.com/profile/api-tokens**, use **Roll** on the token
to get a fresh value, and update the secret in GitHub. Use Cloudflare's copy
button rather than selecting the text by hand, and paste it straight into GitHub
without going via any other app.

**The portal address shows an error.** Give it two minutes after the green tick,
then reload. If it persists, tell me what the page says.

**`/setup` says the secret is incorrect.** The phrase in Cloudflare and the
phrase you typed do not match. Check for a trailing space when you pasted it.

**`/setup` says the deployment already has users.** Someone already created the
first account — probably you, in an earlier attempt. Just sign in normally.

---

## Two things for later

**Your own web address.** Right now the portal lives at a `.workers.dev`
address. It can live at something like `portal.kesmic.org` instead, without
moving your domain away from Wix and without touching your existing website —
but it needs a change on my side first. Tell me when you want it and I will
handle that part.

**Backups.** Cloudflare keeps your information safely, but there is no automatic
copy you hold yourself. For records about clients and employees, you want one.
Ask me and I will set up automatic backups for you — it is not something you
need to do by hand.
