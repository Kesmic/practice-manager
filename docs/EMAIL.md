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

## How SPF works, in one paragraph

An SPF record is a **TXT record**, not part of the MX record. The MX record says
where mail to you is delivered; SPF says who is allowed to send mail as you. They are
separate records that happen to sit on the same name. Adding a sender never means
touching MX.

The rule that matters: **a domain may publish exactly one SPF record.** You do not
add a second `v=spf1` line for each new sender. You edit the one you have and add
another `include:` inside it, keeping a single `-all` at the very end. Two SPF
records is not "belt and braces", it is a failure: a receiving server that finds two
stops and treats the check as failed rather than picking one.

## Where kesmic.org stands

Checked live. There is now **one SPF record**, and it already carries Amazon SES,
which is what Resend sends through:

```
v=spf1 include:spf.protection.outlook.com include:amazonses.com -all
```

That is correct and needs no further change for sending. Two things to be aware of:

**Zoho Books has dropped out.** The record used to include
`include:sender.zohobooks.com`. It does not any more, and the record ends in `-all`,
which is a hard fail. If you still send invoices or statements from Zoho Books using
an `@kesmic.org` address, those are now failing SPF and some will be rejected
outright. If you do, put it back:

```
v=spf1 include:spf.protection.outlook.com include:amazonses.com include:sender.zohobooks.com -all
```

If you have stopped using Zoho for mail, leave it out. A shorter SPF record is a
better one.

**DMARC still has the angle brackets in it.** It currently reads:

```
v=DMARC1; p=none; rua=mailto:<michael@kesmic.org>
```

The address is right now, but `<` and `>` are not allowed inside a DMARC `rua`, so
most reporting services will discard the whole URI and you will receive nothing. Edit
the TXT record on the name `_dmarc` and remove the two brackets:

```
v=DMARC1; p=none; rua=mailto:michael@kesmic.org
```

---

## Choosing a provider, and why Wix decides it for you

**Resend cannot be verified while kesmic.org's DNS is at Wix.** This is not a mistake
you can configure your way out of. Resend verifies a domain by asking you to create
an **MX record on a subdomain**, `send.kesmic.org`, so that bounces and complaints
come back to it. Wix only allows MX records on the root domain, so the record cannot
be created, and Resend says so plainly: "Wix doesn't support subdomains for MX
records."

Three ways out, in the order I would try them:

**1. Use Postmark or SendGrid instead.** Both verify a domain with **TXT and CNAME
records only**, which Wix does support: `portal.kesmic.org` is already a CNAME at
Wix, so we know it works. This changes nothing about the portal except one setting,
because the portal speaks to all three. **This is the recommended route** and the
rest of this guide assumes it.

| | Verifies with | Free allowance |
| --- | --- | --- |
| **Postmark** | DKIM `TXT`, plus an optional return-path `CNAME` | 100 a month, then paid |
| **SendGrid** | three `CNAME` records | 100 a day |
| Resend | `TXT` + `CNAME` + **`MX` on a subdomain** | 3,000 a month |

Postmark is the better of the two for this purpose: it is built for transactional
mail, its deliverability is excellent, and a compliance practice will send tens of
notifications a day rather than thousands.

**2. Move DNS hosting to Cloudflare, keeping the domain registered at Wix.** If Wix
offers to change your nameservers, pointing them at Cloudflare gives you a DNS
provider with no such limits, and Resend then verifies normally. The catch is that
every existing record has to be recreated at Cloudflare first, including the ones
that keep your website and your Microsoft 365 mail working. Get one wrong and email
stops. Worth doing eventually, not worth doing to save one setting.

**3. Send through Microsoft 365, which you already pay for.** No DNS changes at all,
since Microsoft is already authorised in your SPF. It needs an app registration in
Azure with permission to send mail, which is more setup than either option above and
gives an application the ability to send as your firm. I would not start here.

---

## Part 1 - Create a sending account

Sign up at **https://postmarkapp.com** and confirm your email address. Postmark asks
what you will use it for; "transactional notifications for our own staff" is the
honest answer and the one that gets approved.

If you would rather use SendGrid, sign up at **https://sendgrid.com** instead and
follow the same shape of steps. Everything below applies to both.

## Part 2 - Tell it that it may send as kesmic.org

In Postmark: **Sender Signatures → Add Domain**, enter `kesmic.org`, and it shows you:

- one **TXT** record, with a name beginning `pm-` or ending `._domainkey` (this is
  DKIM, and it is the one that matters)
- one optional **CNAME** record, `pm-bounces`, pointing at `pm.mtasv.net`

Add both in Wix under **Domains → ⋯ next to kesmic.org → Manage DNS records**,
matching the type, name and value exactly. Add the CNAME as well as the TXT: it is
optional for verification and it noticeably helps deliverability, and unlike Resend's
MX record, Wix will accept it.

Then click **Verify** in Postmark. It usually takes a few minutes and occasionally a
few hours. **Do not skip it.** An unverified domain means every email is refused.

## Part 3 - Leave your SPF record alone

This is the pleasant part. With the return-path CNAME in place, SPF is checked
against `pm-bounces.kesmic.org`, which resolves to Postmark's own record. **You do not
need to add Postmark to kesmic.org's SPF at all**, and you should not: every extra
`include:` costs one of the ten DNS lookups SPF allows before it fails.

The `include:amazonses.com` already in your record is only needed if something else
sends through Amazon SES. If Postmark is your only new sender, you can shorten it to:

```
v=spf1 include:spf.protection.outlook.com -all
```

Add `include:sender.zohobooks.com` back if Zoho Books still sends as `@kesmic.org`.
Whatever you end up with, keep it as **one** record with `-all` at the end, once.

## Part 4 - Create the key

In Postmark, open your server, go to **API Tokens**, and copy the **Server API
token**. In SendGrid it is **Settings → API Keys → Create API Key**, with **Mail
Send** permission.

Copy it now; both show it once.

## Part 5 - Give the portal its four settings

In Cloudflare: **Workers & Pages → kesmic-practice-manager → Settings → Variables
and Secrets**, on the **Production** side. Add four:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `EMAIL_API_KEY` | the token from Part 4 |
| Text | `EMAIL_FROM` | `Kesmic Practice Manager <portal@kesmic.org>` |
| Text | `EMAIL_PROVIDER` | `postmark`, or `sendgrid`, or `resend` |
| Text | `PORTAL_URL` | `https://portal.kesmic.org`, or your `.pages.dev` address |

Notes on those:

- `EMAIL_PROVIDER` is the only thing that changes if you switch services later. Leave
  it out and the portal assumes Resend, which is what it did before this setting
  existed. A name it does not recognise is refused with a message saying so, rather
  than quietly sending to the wrong place.

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

The log names the provider, so `postmark returned 422` and `resend returned 422` are
distinguishable at a glance.

| What the log says | What it means |
| --- | --- |
| `... returned 401` or `403` | The token is wrong, or was revoked. Make a new one. |
| `... returned 422` with "domain not verified" or Postmark's `ErrorCode 400` | Part 2 is unfinished. Go back and verify the domain. |
| `... returned 422` with "from" in it | `EMAIL_FROM` uses a domain you have not verified. |
| `EMAIL_PROVIDER is "..."` | The provider name is misspelt. It must be `postmark`, `sendgrid` or `resend`. |
| Nothing at all appears | `EMAIL_API_KEY` or `EMAIL_FROM` is missing, or you have not published since adding them. |

**Emails arrive but land in spam.** Almost always DKIM or SPF. Check with a checker
such as mxtoolbox.com that kesmic.org has exactly one SPF record, and that the DKIM
record from Part 2 resolves.

**One person is not getting them.** Ask them to look at **My account** in the
portal. They may have turned email off. Also check their account is not suspended.

---

## Turning it off again

Delete `EMAIL_API_KEY` in Cloudflare and publish again. Everything else keeps
working, and the portal inbox is unaffected.
