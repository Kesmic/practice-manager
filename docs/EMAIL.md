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

Checked live, and in good order. **One SPF record**, correctly formed:

```
v=spf1 include:spf.protection.outlook.com -all
```

SendGrid does not belong in it (see Part 3), so this needs no change for the portal.
DMARC is valid too, having had a stray pair of angle brackets removed:

```
v=DMARC1; p=none; rua=mailto:michael@kesmic.org
```

**One thing still open: Zoho Books.** The SPF record used to include
`include:sender.zohobooks.com` and no longer does, against a record that ends in
`-all`, a hard fail. If invoices or statements still go out from Zoho Books using an
`@kesmic.org` address, that mail is failing SPF today and some of it will be rejected
outright. If Zoho is still in use, make it:

```
v=spf1 include:spf.protection.outlook.com include:sender.zohobooks.com -all
```

If you have stopped using Zoho for mail, leave it out. A shorter SPF record is a
better one, and every `include:` spends one of the ten lookups the standard allows.

**`p=none` in DMARC means "watch, do not enforce".** That is the right place to start.
Once you have had reports for a month and can see that Microsoft 365 and SendGrid are
both passing, tighten it to `p=quarantine` and later `p=reject`. Doing that before the
reports look clean would send your own legitimate mail to junk.

---

## Choosing a provider, and why Wix decides it for you

**Resend cannot be verified while kesmic.org's DNS is at Wix.** This is not a mistake
you can configure your way out of. Resend verifies a domain by asking you to create
an **MX record on a subdomain**, `send.kesmic.org`, so that bounces and complaints
come back to it. Wix only allows MX records on the root domain, so the record cannot
be created, and Resend says so plainly: "Wix doesn't support subdomains for MX
records."

Three ways out, in the order I would try them:

**1. Use SendGrid or Postmark instead.** Both verify a domain with **TXT and CNAME
records only**, which Wix does support: `portal.kesmic.org` is already a CNAME at
Wix, so we know it works. This changes nothing about the portal except one setting,
because the portal speaks to all three. **This is the route Kesmic took**, with
SendGrid, and it is what the rest of this guide describes.

| | Verifies with | Free allowance |
| --- | --- | --- |
| **SendGrid** (in use) | three `CNAME` records | 100 a day |
| **Postmark** | DKIM `TXT`, plus an optional return-path `CNAME` | 100 a month, then paid |
| Resend | `TXT` + `CNAME` + **`MX` on a subdomain** | 3,000 a month |

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

Sign up at **https://sendgrid.com** and confirm your email address. It asks what you
will use it for; "transactional notifications for our own staff" is the honest answer
and the one that gets approved.

If you would rather use Postmark, sign up at **https://postmarkapp.com** instead. It
gives you a DKIM `TXT` record and an optional `pm-bounces` return-path `CNAME`, both
of which Wix accepts, and Part 5 is the same but with `EMAIL_PROVIDER = "postmark"`.

## Part 2 - Tell SendGrid it may send as kesmic.org

**Settings → Sender Authentication → Authenticate Your Domain.** DNS host **Other**,
domain `kesmic.org`.

**Before you finish the wizard, open Advanced Settings and set a custom DKIM
selector.** This step is not optional here, and skipping it is a dead end:

> SendGrid always generates the selectors `s1` and `s2`, so the records it asks for
> are `s1._domainkey.kesmic.org` and `s2._domainkey.kesmic.org`. **Wix already owns
> both.** Wix Email Marketing, which is itself built on SendGrid, has published them
> pointing at `s006.ascendbywix.com`. Wix will refuse your records with "You already
> added a record with this value", and no amount of retrying will change that: two
> SendGrid accounts cannot share one selector on one domain.

Enter one to three characters of your own. Kesmic uses **`kpm`**, which gives
`kpm._domainkey` and `kpm2._domainkey` and collides with nothing. The option only
appears while you are first creating the domain authentication, so if you have already
created it with the defaults, **delete it and start again**.

SendGrid then shows three `CNAME` records: one beginning `em`, which is the return
path, and the two DKIM records. Add all three in Wix under **Domains → ⋯ next to
kesmic.org → Manage DNS records**, matching name and value exactly. Then click
**Verify**. It usually takes minutes and occasionally hours.

**Do not skip verification.** An unverified domain means every email is refused.

What is live on kesmic.org today, for reference:

```
kpm._domainkey.kesmic.org   CNAME  kpm.domainkey.u112335505.wl006.sendgrid.net
kpm2._domainkey.kesmic.org  CNAME  kpm2.domainkey.u112335505.wl006.sendgrid.net
```

Leave Wix's `s1` and `s2` records alone. They belong to Wix Email Marketing, and
deleting them would break it for whoever is using it.

## Part 3 - Leave your SPF record alone

This is the pleasant part. The `em` CNAME from Part 2 is the return path, so SPF is
checked against that subdomain, which resolves to SendGrid's own record. **You do not
need to add SendGrid to kesmic.org's SPF at all**, and you should not: every extra
`include:` costs one of the ten DNS lookups SPF allows before it fails.

The record is currently, correctly:

```
v=spf1 include:spf.protection.outlook.com -all
```

Add `include:sender.zohobooks.com` back if Zoho Books still sends as `@kesmic.org`;
it was dropped at some point, and against a record ending in `-all` that mail will be
failing. Whatever you end up with, keep it as **one** record with `-all` at the end,
exactly once.

While you are in the DNS editor, delete the leftover `resend._domainkey` TXT record.
It holds a signing key for an account no longer in use and only misleads whoever reads
your DNS next.

## Part 4 - Create the key

**Settings → API Keys → Create API Key.** Name it `Kesmic Practice Manager` and give
it **Restricted Access** with **Mail Send** only. Nothing else in the portal needs
SendGrid, so nothing else should be permitted.

Copy it now; SendGrid shows it once.

## Part 5 - Give the portal its four settings

**Only one of the four goes in the Cloudflare dashboard.** The other three are in
`wrangler.toml` in the repository, and are already set. If you open the dashboard you
will see it say so:

> Environment variables for this project are being managed through wrangler.toml.
> Only Secrets (encrypted variables) can be managed via the Dashboard.

That is correct and is how it should be. Ordinary settings are configuration and
belong in version control, where a change is reviewable and cannot be lost with a
browser tab. Only the API key is secret.

**The one to add by hand.** In Cloudflare: **Workers & Pages →
kesmic-practice-manager → Settings → Variables and Secrets**, **Production** side,
**Add → Secret**:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `EMAIL_API_KEY` | the token from Part 4 |

**The three already set**, in `wrangler.toml` under `[vars]`:

| Name | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `sendgrid` |
| `EMAIL_FROM` | `Kesmic Practice Manager <portal@kesmic.org>` |
| `PORTAL_URL` | `https://portal.kesmic.org` |

To change any of those three, edit `wrangler.toml` and push. Trying to add them in
the dashboard will not work, and that is the message you are seeing.

Notes:

- **Change `EMAIL_FROM` if you would rather use a different mailbox.** Any address at
  a domain you authenticated in Part 2 will do. It does not have to be a real inbox
  to send from, but making it one means replies are not silently lost.
- `EMAIL_PROVIDER` is the only thing that changes if you switch services later. Left
  out, the portal assumes Resend, which is what it did before this setting existed. A
  name it does not recognise is refused with a message saying so, rather than quietly
  sending to the wrong place.
- Your existing secrets, `BOOTSTRAP_SECRET` and `PASSWORD_PEPPER`, are untouched by
  this. Secrets are stored separately from the plain variables and a deploy does not
  disturb them.

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

## The portal will tell you what is wrong

**Portal administration → Email**, at Partner grade. It reads the settings from the
running system rather than from what anyone believes is set, and it shows:

- whether email is configured at all
- which provider is in use
- whether an API key is present, and how many characters it has, which catches a
  truncated paste without ever showing the key
- the address it sends as, and where links point
- how many active people would actually be emailed

Anything missing is listed underneath, naming the setting and where it belongs.

**Send a test email** goes to your own address and nowhere else, and reports what the
provider answered, in the provider's own words. That is the difference between "nothing
happened" and "SendGrid says the sender identity is not verified". Start here whenever
somebody says email is not working.

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
