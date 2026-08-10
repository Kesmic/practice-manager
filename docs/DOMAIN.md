# Putting the portal on portal.kesmic.org

## The constraint that decides everything

Two facts, both verified, that between them rule out the obvious approach:

1. **Cloudflare will only let the portal answer to `portal.kesmic.org` if
   Cloudflare manages the whole domain's DNS.** You cannot point a record at the
   portal's `.workers.dev` address from somewhere else; Cloudflare rejects it.
2. **Wix does not allow a Wix-registered domain to use anyone else's
   nameservers.** This is Wix policy, not a setting that is hidden somewhere, their help centre states that changing nameservers requires transferring the
   domain away from Wix. It is why the domain's **⋯** menu offers *Manage DNS
   records* and *Transfer away from Wix*, but nothing about nameservers.

So as long as kesmic.org is registered at Wix, Cloudflare cannot manage its DNS.
The way round it is Cloudflare Pages, which the portal now uses; the whole job is
one record.

---

## The plan: one record at Wix

The portal now runs as a Cloudflare **Pages** project, which is the one Cloudflare
product that accepts a subdomain pointed at it from someone else's DNS. So Wix
keeps managing kesmic.org exactly as it does today, and you add a single record.

**Nothing that currently works is touched.** Not your website, not your email, not
one existing record. The sixteen records listed further down stay exactly as they
are - they are there for reference, not because anything needs doing to them.

### Step 1 - Register the name with Cloudflare first

This step is not optional and the order matters: adding the record at Wix before
Cloudflare knows about the name gives visitors an error page rather than the
portal.

1. Sign in at **https://dash.cloudflare.com**
2. Go to **Workers & Pages**. You will see **two** entries called
   **kesmic-practice-manager** - the old Worker and the new Pages project. Look at
   the type shown beside each and **click the one that says Pages.**

   > If you open the wrong one you will know: the Worker's page says **Worker URL**
   > at the top, and its domain dialog says "Connect your *Worker* to a domain in
   > your account" and then "No zones match portal.kesmic.org". That is the dead
   > end this whole page exists to avoid - click **Cancel**, never **Onboard
   > domain**, which would start moving the whole domain to Cloudflare.
   >
   > The Pages project shows an address ending **.pages.dev** instead.

3. Open the **Custom domains** tab
4. Click **Set up a custom domain**
5. Type `portal.kesmic.org` and continue

Cloudflare will then show you the record it wants - a **CNAME** for `portal`
pointing at something ending in **.pages.dev**. Copy that target exactly.

### Step 2 - Add that one record at Wix

1. In your Wix account, go to **Domains**
2. Click the **⋯** button to the right of **kesmic.org**
3. Choose **Manage DNS records**
4. Find the **CNAME (Aliases)** section and click **+ Add Record**
5. Fill it in:

   | Field | Value |
   | --- | --- |
   | Host name | `portal` |
   | Value / Points to | the `.pages.dev` target from Step 1 |
   | TTL | leave as it is |

6. Save

### Step 3 - Wait for the padlock

Back on the Cloudflare **Custom domains** tab, the entry for
`portal.kesmic.org` moves from *pending* to **Active** once it can see the record.
Usually a few minutes; occasionally up to a few hours. Cloudflare issues the
security certificate itself - there is nothing to buy or install.

When it is Active, open **https://portal.kesmic.org**. You should get the portal's
sign-in screen with a padlock in the address bar.

The `.pages.dev` address keeps working as well, so nobody's bookmark breaks.

### If it does not come up

- **An error page mentioning DNS or a 522.** The record has not been seen yet, or
  the target was mistyped. Re-check the value in Wix against Step 1 - it is easy
  to paste a trailing space.
- **A certificate warning.** Cloudflare has not finished issuing the certificate.
  Give it an hour before worrying.
- **Nothing happens at all after a few hours.** Tell me and I will check what the
  name is resolving to.

Removing it later is the reverse: delete the custom domain in Cloudflare, delete
the CNAME at Wix. Nothing else is affected.

### Step 4 - Delete the old Worker

Once the new address works, remove the old Worker so there is only one of
everything and no chance of opening the wrong one again. In **Workers & Pages**,
click the **kesmic-practice-manager** that says **Worker**, then **Settings →
Delete**.

This does not touch the database - the Worker is only a front door, and the
records live separately. Both front doors read the same data, which is why nothing
is lost.

---

## Why not the other ways

**Why not simply point the subdomain at the Worker?** Cloudflare will only let a
Worker answer on your own name if Cloudflare manages the whole domain's DNS, and
Wix does not permit a Wix-registered domain to use anyone else's nameservers, their help centre states that moving nameservers requires transferring the domain
away. That is why the domain's **⋯** menu offers *Manage DNS records* and
*Transfer away from Wix*, with nothing in between.

**Why not transfer the domain away from Wix?** It would work, and it would let the
portal keep its original setup with no code changes. But it means a five-to-seven
day registrar transfer, buying the name from someone else, and recreating all
sixteen DNS records - including the firm's Microsoft 365 mail - at Cloudflare
afterwards. Pointing one record is a great deal less that can go wrong.

---

## Reference: every DNS record on kesmic.org

Read from live DNS on **9 August 2026**. **Nothing here needs changing** - the
portal's subdomain is added alongside all of it. It is written down because it is
worth having a record of how the domain is set up, and because it is what you
would need if you ever did move the domain elsewhere. The lines marked ⚠️ are your
firm's email.

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

## Two email problems worth fixing separately

Neither is caused by anything on this page - both are live today, and both are
fixed in Wix under **Domains → ⋯ → Manage DNS records**, the same screen you used
for the subdomain. Do them as a separate sitting, so you are only ever changing one
thing at a time.

**Your domain has two SPF records, and may only ever have one.** You have
`v=spf1 include:spf.protection.outlook.com -all` for Microsoft 365 and
`v=spf1 include:sender.zohobooks.com` for Zoho Books. When a receiving mail server
finds two, the rule is that it stops and treats the check as broken rather than
picking one - so some of your legitimate email is likely being treated as
suspicious or filed as spam. Delete both, and add this single record in their
place:

```
v=spf1 include:spf.protection.outlook.com include:sender.zohobooks.com -all
```

**You have no DMARC record.** That is the instruction telling other mail systems
what to do with email that only pretends to come from kesmic.org. Without it,
forging your firm's address is easier than it should be - which matters for a
practice that emails clients about their tax affairs. A safe starting point, which
only asks for reports and changes nothing about delivery:

```
Type: TXT   Name: _dmarc   Value: v=DMARC1; p=none; rua=mailto:<your address>
```
