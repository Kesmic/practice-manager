# Putting the portal on portal.kesmic.org

## The constraint that decides everything

Two facts, both verified, that between them rule out the obvious approach:

1. **Cloudflare will only let the portal answer to `portal.kesmic.org` if
   Cloudflare manages the whole domain's DNS.** You cannot point a record at the
   portal's `.workers.dev` address from somewhere else; Cloudflare rejects it.
2. **Wix does not allow a Wix-registered domain to use anyone else's
   nameservers.** This is Wix policy, not a setting that is hidden somewhere —
   their help centre states that changing nameservers requires transferring the
   domain away from Wix. It is why the domain's **⋯** menu offers *Manage DNS
   records* and *Transfer away from Wix*, but nothing about nameservers.

So as long as kesmic.org is registered at Wix, Cloudflare cannot manage its DNS,
and the portal cannot be given that name **in its current form**.

There are three honest ways forward.

---

## Route A — Move the portal to Cloudflare Pages (recommended)

Cloudflare Pages is the one Cloudflare product that accepts a subdomain pointed at
it from someone else's DNS. Convert the portal to a Pages project and Wix keeps
managing kesmic.org exactly as it does today.

**What you do:** add one record in Wix — a CNAME called `portal` pointing at the
project's `.pages.dev` address — and register that same name in Cloudflare first
so it is recognised.

**What this costs:**

- About an hour of development work to convert the project.
- The portal's underlying address changes, so the two secrets
  (`PASSWORD_PEPPER`, and `BOOTSTRAP_SECRET` if it is still there) are entered
  again on the new project.
- Pages is the older of Cloudflare's two ways of doing this. It is not being shut
  down — Cloudflare is folding its features into Workers rather than retiring it,
  and new projects are still created normally — but it is the less
  actively-developed side.

**What this does not cost:** nothing about your website or your email is touched.
Not one existing record changes. The database, and therefore every account and
record in the portal, carries over untouched.

**Why it is recommended:** it is the only route that gives you the name you want
while honouring the thing you asked for at the outset — no transferring the
domain — and it puts nothing at risk that is currently working.

---

## Route B — Transfer the domain away from Wix

If kesmic.org is registered somewhere that lets you choose nameservers —
Cloudflare Registrar being the obvious candidate, at cost price and usually
cheaper than Wix — then Cloudflare can manage the DNS, and the portal keeps its
current, more modern setup with **no code changes at all**. `portal.kesmic.org`
becomes a single click.

**What this costs:**

- A registrar transfer: unlock the domain at Wix, get the authorisation code,
  start the transfer at the new registrar, wait roughly five to seven days. A
  domain cannot be transferred within 60 days of registration or a previous
  transfer.
- Your DNS records then have to be recreated at Cloudflare. This is where the
  care is needed, because **your firm's Microsoft 365 email runs on this domain**
  — the full list is at the end of this page.
- You stop paying Wix for the domain and start paying the new registrar.

**Worth knowing:** the website itself stays on Wix either way. A registrar
transfer moves who you buy the name from, not where the site is hosted.

---

## Route C — Leave it on the `.workers.dev` address

The portal already works, over HTTPS, at
`kesmic-practice-manager.kesmicgh.workers.dev`. Staff can bookmark it. The only
thing wrong with it is that it does not carry the firm's name.

Nothing to do, nothing at risk, and the decision stays open indefinitely.

---

## Reference: every DNS record on kesmic.org

Read from live DNS on **9 August 2026**. You need this only for **Route B**, where
the records have to be recreated — but it is worth keeping regardless, as a record
of how the domain is set up. The lines marked ⚠️ are your firm's email.

### Website (Wix)

| Type | Name | Value |
| --- | --- | --- |
| A | `kesmic.org` | `185.230.63.107` |
| A | `kesmic.org` | `185.230.63.186` |
| A | `kesmic.org` | `185.230.63.171` |
| CNAME | `www` | `cdn1.wixdns.net` |

### Email and Microsoft 365

| Type | Name | Value | |
| --- | --- | --- | --- |
| MX | `kesmic.org` | `kesmic-org.mail.protection.outlook.com`, priority `10` | ⚠️ |
| TXT | `kesmic.org` | `v=spf1 include:spf.protection.outlook.com -all` | ⚠️ |
| TXT | `kesmic.org` | `MS=ms63727400` | ⚠️ |
| CNAME | `autodiscover` | `autodiscover.outlook.com` | ⚠️ |
| CNAME | `enterpriseregistration` | `enterpriseregistration.windows.net` | |
| CNAME | `enterpriseenrollment` | `enterpriseenrollment.manage.microsoft.com` | |
| CNAME | `msoid` | `clientconfig.microsoftonline-p.net` | |
| CNAME | `lyncdiscover` | `webdir.online.lync.com` | |
| CNAME | `sip` | `sipdir.online.lync.com` | |

`autodiscover` is what lets Outlook and phones configure themselves. Without it,
existing mailboxes keep working but new devices cannot be set up.

### Teams / Skype call routing

| Type | Name | Priority | Weight | Port | Target |
| --- | --- | --- | --- | --- | --- |
| SRV | `_sipfederationtls._tcp` | 100 | 1 | 5061 | `sipfed.online.lync.com` |
| SRV | `_sip._tls` | 100 | 1 | 443 | `sipdir.online.lync.com` |

### Verifications

| Type | Name | Value |
| --- | --- | --- |
| TXT | `kesmic.org` | `google-site-verification=c8u2KwJyx-epiAo7eRaZw73_ix5Ns1Ch4kqrrFISKTc` |
| TXT | `kesmic.org` | `google-site-verification=HPupNqjhh9PB6fF9-lt19wnpYpp3sP8DgNHrULYYEFA` |
| TXT | `kesmic.org` | `v=spf1 include:sender.zohobooks.com` |

Sixteen records in total. Nameservers are currently `ns12.wixdns.net` and
`ns13.wixdns.net`.

---

## Two email problems worth fixing, whichever route you take

Neither is caused by anything here — both are live today. Both are fixed in Wix
under **Domains → ⋯ → Manage DNS records**.

**Your domain has two SPF records, and may only ever have one.** You have
`v=spf1 include:spf.protection.outlook.com -all` for Microsoft 365 and
`v=spf1 include:sender.zohobooks.com` for Zoho Books. When a receiving mail server
finds two, the rule is that it stops and treats the check as broken rather than
picking one — so some of your legitimate email is likely being treated as
suspicious or filed as spam. Delete both, and add this single record in their
place:

```
v=spf1 include:spf.protection.outlook.com include:sender.zohobooks.com -all
```

**You have no DMARC record.** That is the instruction telling other mail systems
what to do with email that only pretends to come from kesmic.org. Without it,
forging your firm's address is easier than it should be — which matters for a
practice that emails clients about their tax affairs. A safe starting point, which
only asks for reports and changes nothing about delivery:

```
Type: TXT   Name: _dmarc   Value: v=DMARC1; p=none; rua=mailto:<your address>
```
