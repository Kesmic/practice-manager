# What could be better in the portal

An honest review of what is missing or weak, in the order I would fix it. Mostly these
are gaps between what the portal does today and what a compliance practice actually
needs from it, rather than things that are broken - though **Since this was written**,
below, records the two that were.

I wrote the portal, so treat this as a self-assessment rather than an independent
one. Where I think something is a real problem I have said so plainly.

---

## The one I would do first

### Nothing warns you before a deadline

This is the biggest gap, and it is odd in a system built around statutory deadlines.
Today the portal knows every deadline and tells you nothing until you look. A late
VAT return costs the client money and costs you the relationship, and the portal
currently relies on somebody remembering to check.

What it should do: run once each morning, find everything due in the next fourteen,
seven, three and one days, plus everything already overdue, and send each person a
single message covering their own work, with a copy to the responsible manager. One
email a day, not one per deliverable, because a daily digest gets read and a stream
of individual alerts gets filtered.

Cloudflare can run scheduled work, so this needs no new service. It is perhaps half
a day, and it would change the portal from a place where the answer is recorded into
one that actually chases. Now that email works, this is the natural next thing.

---

## Worth doing soon

### Documents are links, not files

Every attachment in the portal is a link to a file living somewhere else. That was
the right first decision, because it avoided making you set up file storage before
you could use anything. But in practice it means a preparer has to keep working
papers somewhere else and paste addresses in, and a reviewer has to trust the link
still points where it did.

Real uploads would mean adding Cloudflare R2, which is a storage bucket, roughly an
hour of work and about a dollar a month at your volumes. Worth it for signed
documents, identification and certificates in particular, where "the link broke" is
not an acceptable answer three years later.

### There are no backups you hold yourself

Cloudflare keeps your data safely and can roll the database back thirty days. What
you do not have is a copy of your own, outside Cloudflare, that survives an account
problem, a billing lapse or a mistake nobody notices for a month.

For a firm holding client tax records and staff bank details this should not stay
outstanding. A scheduled job can export the whole database weekly and put the file
somewhere you control. Half a day.

### No self-service password reset

Today a forgotten password means finding an administrator. That is honest and
workable at your size, but it puts you personally in the loop at inconvenient
moments, and it will not scale past about ten people.

Now that email works this is straightforward: a one-time link, valid for an hour,
single use. Two to three hours. I left it out earlier because without email it was
not possible to do safely.

### Nothing to search with

You navigate by list and filter. There is no single box where you can type a client
name, a reference, or a few words from a deliverable title. With fourteen templates
and a handful of clients that is fine. At a hundred clients and a year of filings it
becomes the main way people would want to move around, and its absence will be felt
long before that.

---

## Worth doing eventually

### Reports cannot be exported

The four reports are useful on screen and cannot leave it. Anyone who wants to put
overdue exposure in a partners' meeting pack has to retype it. A download button
producing a spreadsheet on each report is an hour, and it is the sort of thing people
ask for immediately once they start relying on the numbers.

### No calendar view of the filing calendar

The portal calls it a filing calendar and shows it as a list. A month grid, with each
deliverable on its statutory date and coloured by status, is how people actually
think about deadlines, and it makes a bad week visible at a glance in a way a sorted
list does not.

### Nothing handles someone being away

If a reviewer is on leave, work sits in Submitted until somebody notices. Any Senior
Associate can pick it up, which saves you, but nothing prompts them to. A way to mark
yourself away, with your queue surfaced to colleagues while you are, would prevent
the failure rather than rely on someone spotting it.

### No bulk actions

Everything is one at a time. After generating a year of filings, assigning them means
opening each one. Selecting several and assigning them together is an obvious
addition once the portal is genuinely busy.

### Review points cannot carry a file

A reviewer can describe a problem and reference a working paper, but cannot attach a
marked-up page. In practice people will resort to email for that, which takes the
evidence out of the system where it belongs.

---

## One thing to know rather than fix

### Password protection is weaker than I would like, and why

Cloudflare's free plan cuts off every request after a hundredth of a second of
computing time. Scrambling passwords properly needs about thirty times that. The
portal therefore scrambles them less thoroughly than current standards recommend,
compensated by a secret key held outside the database.

That compensation is sound: it means a stolen copy of your database alone is not
enough to attack anybody's password. The other half is now in place too: the portal
stops answering after ten wrong passwords on one account, so a fast hash cannot be
attacked quickly through the front door either. But if you move to the five-dollar
plan I can set this to full strength, and for a firm holding this data I would.

---

## Since this was written

Three things on this list have been built, and one thing not on it turned out to be
wrong. Recorded here rather than deleted, because what a review missed is worth as much
as what it found.

**Two-factor authentication now exists.** This document used to say it did not. Codes
from an authenticator app, recovery codes for the day the phone is lost, and a policy
setting so the firm can require it at whichever grades it chooses.

**Sessions time out when a screen is left unattended**, enforced by the server rather
than only warned about in the browser.

**Sign-in attempts are now limited.** They were not, which was the more serious half of
the password paragraph above and went unmentioned in it: a reduced work factor is only
defensible if the number of guesses is capped, and nothing capped it. Ten failures on
an account or fifty from one address and the portal stops answering for fifteen minutes.

**Reviewing was enforced at the wrong moment.** The rule "an Associate cannot be a
reviewer" was checked when a reviewer was chosen and never again. A Senior Associate
moved down a grade kept their name on every live deliverable and could still sign them
off. Now the grade is checked when they act as well. This one was found by writing the
control down as a test, which is the argument for having tests at all.

---

## Smaller things I noticed

- **The dashboard does not show what is coming.** It shows what is assigned and what
  is overdue, but not "due this week", which is the thing people most want on a
  Monday morning.
- **Wide tables on a phone** scroll sideways inside their own container, which works
  but is not pleasant. The deliverable list in particular would be better as cards on
  a small screen.
- **Time entries cannot be corrected**, only deleted and re-entered. Fine, but mildly
  irritating for a typo in a narrative.
- **No client-facing view.** Clients can now ask for work through the two intake
  links, but they still cannot see the status of anything once it is under way. That
  is a deliberate boundary rather than an oversight, and the intake links are as far
  through it as I would go without a decision from you.
- **Nothing is sent to whoever submitted a request.** Accepting or declining records
  the decision inside the portal and leaves writing back to a person. That is the
  right default for a first version, since a template reply from a compliance firm
  reads badly, but it does mean an enquiry can sit unanswered from the sender's point
  of view while the queue says it was handled.
- **Nothing links a deliverable to an invoice.** Time is recorded and budgets are
  tracked, and nothing turns that into a bill. If you intend to bill from this data
  rather than re-enter it elsewhere, that gap will matter.
- **The review-quality report can be read as a ranking**, which would be unfair to
  whoever does the hardest jobs. The user guide warns about it. A better version
  would weight by job complexity, or simply not aggregate to a league table.

---

## What I would not change

Some things look like gaps and are not:

**Onboarding does not block work.** Someone with an unsigned contract can still reach
their queue. Blocking them would punish the employee for a delay that is usually the
firm's.

**Templates retire rather than delete.** Deleting would orphan the history of every
job made from the template.

**No individual permission switches.** Grades decide everything. Per-person switches
drift and quietly break the separation between preparing and reviewing.

**The portal is not indexed by search engines and has no public pages.** It is a
staff system, and it should stay invisible.

---

## Still true

**There is no automated check of most of the system.** There are now tests over the
workflow engine, the sign-in limit and the deadline arithmetic - the parts where a
mistake is a control failure - and CI runs them on every change. The routes themselves
are still covered only by typechecking and by somebody using the portal. The natural
next step is a handful of end-to-end tests against a local database, exercising a
deliverable from creation to closure.

---

## If you want a shortlist

Three things, in this order, and the portal stops being a good record and starts
being genuinely useful:

1. **Deadline reminders.** Half a day. Changes what the portal is for.
2. **Backups you hold yourself.** Half a day. Removes a real risk.
3. **Real file uploads.** An hour, plus about a dollar a month.

Tell me which of these you want and I will build them.
