# Turning on email notifications

Follow this in your web browser. Roughly 25 minutes, most of it waiting.

**The portal works without this.** Everyone already gets a message in their portal
inbox when something needs them. Email adds a nudge that reaches people who are not
looking at the portal. Until you finish these steps nothing is sent, and nothing
breaks.

---

## What gets emailed, and to whom

Two events send email:

- **Someone comments** on a deliverable.
- **A deliverable changes status**: started, submitted, returned for rework,
  approved, closed, and so on.

The people emailed are everyone actually involved: whoever is doing it, whoever is
reviewing it, whoever created it, and **anyone who has commented on it**. That last
one is what makes following automatic. A partner who asks one question stays in the
loop without having to subscribe to anything.

Whoever caused the event is never emailed about their own action. Anyone who has
turned email off under **My account** is skipped. The portal inbox is unaffected by
that switch and always shows everything.

---

## Before you start: the SPF record

Sending email as `@kesmic.org` means telling the world that a new service is
allowed to send on your behalf. That is what an SPF record does, and **your domain
currently has two of them, which is one too many.**

Here is what is live on kesmic.org today:

```
v=spf1 include:sender.zohobooks.com
v=spf1 include:spf.protection.outlook.com -all
```

The rule is that a domain may publish only one. When a receiving mail server finds
two it stops and treats the check as failed, rather than picking one. That is
already costing you: some of your legitimate email is being treated as suspicious.
Adding a third sender on top of a broken record would make it worse.

**Fix it first.** In Wix: **Domains → ⋯ next to kesmic.org → Manage DNS records**,
find the TXT section, **delete both** records above, and add this single one in
their place:

```
v=spf1 include:spf.protection.outlook.com include:sender.zohobooks.com -all
```

That covers Microsoft 365 and Zoho Books in one record. You will add the new sender
to it in Part 3.

**Also fix your DMARC record while you are there.** It currently reads:

```
v=DMARC1; p=none; rua=mailto:<your address>
```

`<your address>` was a placeholder in my example and got pasted literally, so the
reports have nowhere to go. Change that TXT record on the name `_dmarc` to use a
real mailbox, for example:

```
v=DMARC1; p=none; rua=mailto:dmarc@kesmic.org
```

---

## Part 1 - Create a sending account

The portal needs a service that actually delivers the mail. **Resend** is the one it
is written for. The free allowance is 3,000 emails a month and 100 a day, which is
far more than a firm of your size will send.

1. Sign up at **https://resend.com/signup**
2. Confirm your email address

## Part 2 - Tell Resend it may send as kesmic.org

1. In Resend, go to **Domains** and click **Add Domain**
2. Enter `kesmic.org`
3. Resend shows you **three records to add**: one `TXT` and two `CNAME`, with names
   beginning `resend.` and `send.`

Add each one in Wix under **Domains → ⋯ → Manage DNS records**, matching the type,
name and value exactly. Then come back to Resend and click **Verify**.

Verification usually takes a few minutes and occasionally a few hours. **Do not skip
it.** An unverified domain means every email is refused, and the portal will log
"domain not verified".

## Part 3 - Add Resend to your SPF record

Resend will also ask you to include it in SPF. Edit the single SPF record you
created above so it reads:

```
v=spf1 include:spf.protection.outlook.com include:sender.zohobooks.com include:amazonses.com -all
```

Use whatever `include:` Resend tells you to use, in place of `amazonses.com` if it
differs. Keep it as **one** record with `-all` at the end, exactly once.

## Part 4 - Create the key

1. In Resend, go to **API Keys** and click **Create API Key**
2. Name it `Kesmic Practice Manager`, permission **Sending access**
3. Copy the key. Resend shows it once.

## Part 5 - Give the portal its three settings

In Cloudflare: **Workers & Pages → kesmic-practice-manager → Settings → Variables
and Secrets**, on the **Production** side. Add three:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `EMAIL_API_KEY` | the key from Part 4 |
| Text | `EMAIL_FROM` | `Kesmic Practice Manager <portal@kesmic.org>` |
| Text | `PORTAL_URL` | `https://portal.kesmic.org`, or your `.pages.dev` address |

Notes on those:

- `EMAIL_FROM` must use a domain you verified in Part 2. The mailbox part,
  `portal@`, does not need to exist as a real inbox to send from. Consider making
  it a real address anyway so replies do not vanish.
- `PORTAL_URL` is only used to build the links in the emails. Set it to whichever
  address your staff actually use.

**Then publish again, or none of it takes effect.** A Pages project reads these when
it is next published. Go to
**https://github.com/Kesmic/practice-manager/actions**, click **Deploy**, then
**Run workflow → Run workflow**, and wait for the green tick.

## Part 6 - Test it

1. Sign in and open any deliverable
2. Assign it to a colleague, or ask them to comment on it
3. Add a comment yourself

They should have an email within a minute. Check the spam folder on the first one:
if it lands there, the SPF or the domain verification is not right yet.

---

## If it does not arrive

The portal never fails because email failed, so a comment always saves whether or
not the message goes out. That also means a silent failure is possible, and the
place to look is Cloudflare's own log.

**Cloudflare: Workers & Pages → kesmic-practice-manager → Logs.** Post a comment
while that page is open and read what appears.

| What the log says | What it means |
| --- | --- |
| `Email provider returned 403` | The API key is wrong, or was revoked. Make a new one. |
| `Email provider returned 422` with "domain not verified" | Part 2 is unfinished. Go back to Resend and verify. |
| `Email provider returned 422` with "from" in it | `EMAIL_FROM` uses a domain you have not verified. |
| Nothing at all appears | `EMAIL_API_KEY` or `EMAIL_FROM` is missing, or you have not published since adding them. |

**Emails arrive but land in spam.** Almost always SPF. Check with a checker such as
mxtoolbox.com that kesmic.org has exactly one SPF record and that it includes
Resend.

**One person is not getting them.** Ask them to look at **My account** in the
portal. They may have turned email off. Also check their account is not suspended.

---

## Turning it off again

Delete `EMAIL_API_KEY` in Cloudflare and publish again. Everything else keeps
working, and the portal inbox is unaffected.
