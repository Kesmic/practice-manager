# Putting the portal on portal.kesmic.org

A step-by-step guide you can follow in your web browser, for moving the portal
from its `.workers.dev` address to **portal.kesmic.org**.

**Read this page before you change anything.** Your firm's email runs on this
domain, so the order of the steps is what keeps it working. Done in this order,
nothing goes down at any point.

---

## Why one setting at Wix is not enough

You cannot simply add a record at Wix pointing at the portal. Cloudflare only
answers to your own name if Cloudflare is the one being asked "where does
kesmic.org live?" — and today Wix is being asked that.

So the change is: **Cloudflare takes over answering that question.**

**This is not transferring your domain.** kesmic.org stays registered with Wix.
You keep paying Wix for it, you keep renewing it there, your website stays exactly
where it is, and you can undo this at any time by putting the old settings back.
The only thing that changes is which company keeps your domain's address book.

You also get something for free out of it: your main website becomes faster and
gets Cloudflare's protection against attacks.

---

## What must survive the move

Cloudflare copies your existing address book across automatically when you add the
domain — but it is best-effort, not a guarantee. This is the full list as it stood
on **9 August 2026**, read directly from your live domain. Check the list
Cloudflare shows you against this one, and add anything it missed.

**The lines marked ⚠️ are your firm's email.** If one of those is missing, mail
stops arriving. They matter more than the website records.

### Your website (Wix)

| Type | Name | Value |
| --- | --- | --- |
| A | `kesmic.org` | `185.230.63.107` |
| A | `kesmic.org` | `185.230.63.186` |
| A | `kesmic.org` | `185.230.63.171` |
| CNAME | `www` | `cdn1.wixdns.net` |

Three separate A records, all on the bare name. That is normal.

### Your email and Microsoft 365

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

`autodiscover` is the one that lets Outlook and phones set themselves up. Without
it, existing mailboxes keep working but new devices cannot be configured.

### Teams / Skype call routing

| Type | Name | Priority | Weight | Port | Target |
| --- | --- | --- | --- | --- | --- |
| SRV | `_sipfederationtls._tcp` | 100 | 1 | 5061 | `sipfed.online.lync.com` |
| SRV | `_sip._tls` | 100 | 1 | 443 | `sipdir.online.lync.com` |

Cloudflare asks for these in separate boxes. For the first one, **Service** is
`_sipfederationtls`, **Protocol** is `_tcp`, and **Name** is `kesmic.org`.

### Other verifications

| Type | Name | Value |
| --- | --- | --- |
| TXT | `kesmic.org` | `google-site-verification=c8u2KwJyx-epiAo7eRaZw73_ix5Ns1Ch4kqrrFISKTc` |
| TXT | `kesmic.org` | `google-site-verification=HPupNqjhh9PB6fF9-lt19wnpYpp3sP8DgNHrULYYEFA` |
| TXT | `kesmic.org` | `v=spf1 include:sender.zohobooks.com` |

That last one has a problem, described at the end of this page. **Copy it across
as-is for now** — fixing it during the move would mean changing two things at once.

**Sixteen records in total.** Count them when you check.

---

## Step 1 — Add kesmic.org to Cloudflare

1. Sign in at **https://dash.cloudflare.com**
2. Click **Add a domain** (sometimes **Add site**)
3. Type `kesmic.org` and continue
4. Choose the **Free** plan
5. Cloudflare reads your current address book and shows you what it found

Nothing has changed yet. Your website and email are still running through Wix at
this point, and will stay that way until Step 4. Everything up to then is
preparation you can take as long as you like over.

## Step 2 — Check the list, add what is missing

Compare what Cloudflare found against the sixteen records above. Add any that are
missing with **+ Add record**.

Take your time here. This is the only step that matters, and it is much easier to
get right now than to fix later.

## Step 3 — Set the website records to "DNS only"

Some records show a cloud icon that can be orange or grey.

For the four **website** records — the three `A` records and `www` — click the
cloud so it is **grey** ("DNS only"). Your website is hosted by Wix and manages
its own security certificate; sending it through Cloudflare's orange cloud as well
can cause certificate warnings.

The email records have no cloud to set. That is expected.

## Step 4 — Switch over, at Wix

Cloudflare now shows you **two nameservers**, each looking something like
`xxxx.ns.cloudflare.com`. Copy both.

1. Go to your Wix account → **Domains**
2. Click **kesmic.org**
3. Look for **Advanced** → **Name Servers**
4. Choose the option to use your **own / external** nameservers
5. Replace the two Wix entries (`ns12.wixdns.net` and `ns13.wixdns.net`) with the
   two from Cloudflare
6. Save

Wix may warn you that your site could disconnect. It will not, because you
recreated its records in Step 2.

## Step 5 — Wait, then check

The change usually takes effect within an hour, occasionally up to a day.
Cloudflare emails you when it has taken over.

Then check three things:

- **https://www.kesmic.org** still loads
- **Send yourself an email** from an outside address — a personal Gmail will do —
  and confirm it arrives
- Outlook on your computer and phone still sends and receives

If anything is wrong, the fastest fix is always to put the two Wix nameservers
back; everything returns to how it was within the hour. Then tell me and we will
find what was missing before trying again.

## Step 6 — Give the portal its address

Only once Step 5 is clean:

1. In Cloudflare, go to **Compute (Workers)** and click **kesmic-practice-manager**
2. Open **Settings**, then find **Domains & Routes**
3. Click **Add**, choose **Custom Domain**
4. Type `portal.kesmic.org` and save

That is the whole thing. Cloudflare creates the record and the security
certificate itself, usually within a couple of minutes. Nothing in the portal
needs changing, and I do not need to do anything on my side.

The old `.workers.dev` address keeps working too, so nobody's bookmark breaks.

---

## Two email problems worth fixing afterwards

Neither is caused by this move — both are there today. Deal with them **after**
the move has settled, so you are only ever changing one thing at a time.

**Your domain has two SPF records, and it should only ever have one.** You have
`v=spf1 include:spf.protection.outlook.com -all` for Microsoft 365 and
`v=spf1 include:sender.zohobooks.com` for Zoho Books. When a receiving mail server
finds two, the rule is that it stops and treats the check as broken rather than
picking one — so some of your legitimate email is likely being marked as suspicious
or landing in spam. The fix is to delete both and add one record that names both
services:

```
v=spf1 include:spf.protection.outlook.com include:sender.zohobooks.com -all
```

**You have no DMARC record.** That is the instruction telling other mail systems
what to do with email that only pretends to come from kesmic.org. Without it,
someone forging your firm's address has an easier time of it — which matters more
than usual for a practice that emails clients about their tax affairs. A safe
starting point, which only asks for reports and changes nothing about delivery:

```
Type: TXT   Name: _dmarc   Value: v=DMARC1; p=none; rua=mailto:<your address>
```

Tell me when you want to do either and I will walk you through it.
