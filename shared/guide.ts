/**
 * The user guide, inside the portal.
 *
 * It lives here rather than only in docs/ because the people who need it are signed in
 * and stuck, not browsing a repository. Each section carries the grade it is written
 * for, so a new Associate is not handed instructions for running the firm's payroll,
 * and a Partner is not left hunting for the parts that apply to them.
 *
 * `minimum` gates a section by grade. Where a section is about an area the firm can
 * configure, it also names that `area`, so a firm that has closed Reports to Managers
 * does not go on offering Managers a page about Reports.
 */

import { ROLE_RANK, type Role } from "./workflow";
import type { Area } from "./visibility";

export interface GuideSection {
  id: string;
  title: string;
  /** One line, shown in the contents list. */
  summary: string;
  /** Lowest grade this is written for. Omitted means everyone. */
  minimum?: Role;
  /** Only shown when the firm has opened this area to the reader. */
  area?: Area;
  /** Markdown. Rendered by the portal's own renderer, so no raw HTML. */
  body: string;
}

export const GUIDE: GuideSection[] = [
  {
    id: "start",
    title: "Starting out",
    summary: "Signing in, your password, and what the dashboard is telling you.",
    body: `
## Signing in

Your account is created for you, and you get an email with a temporary password. That
password works once, for signing in: the portal then asks you to choose your own before
it will let you do anything else. That is deliberate, and it is why nobody, including a
Partner, can carry on using a password that was emailed to them.

If the email never arrives, ask a Partner to look under **Portal settings, Email
notifications**. It reports whether the portal can send mail at all, which is usually
the answer.

## Your dashboard

Five figures across the top, and each one is a link to the work behind it:

- **Assigned to me** is everything open that is yours to do.
- **Awaiting my review** is work other people have handed to you.
- **In rework** is your own work that came back with review points on it.
- **Overdue** counts by the earlier of the internal target and the statutory deadline.
- **Due within 7 days** is the same measure, looking forward.

Underneath, **My deliverables** is your list. If you are a reviewer you also get
**Awaiting your review** above it.

## The inbox

The Inbox button in the top right is the system of record for notifications. Email is a
copy of it. If email is switched off, or your provider eats a message, nothing is lost:
it is in the inbox.

You can turn your own email off under **My account** without affecting the inbox.
`,
  },

  {
    id: "work",
    title: "Doing a piece of client work",
    summary: "From assigned to submitted, and what the procedures list is for.",
    body: `
## The states a deliverable goes through

    Not started -> In progress -> Submitted -> Under review -> Approved -> Closed
                                       ^              |
                                       |              v
                                       +---------- Rework

You move it along with the buttons on the deliverable itself. Only the buttons you are
allowed to press are shown, so if something you expect is missing it is because the
rules do not allow it, not because it is hidden somewhere.

## Procedures

The checklist on a deliverable is the firm's method for that job. Items marked
**mandatory** must be ticked before it can be submitted. This is not bureaucracy: it is
what lets a reviewer trust that the obvious things were done without redoing them.

## Submitting

**Submit for review** hands it to the reviewer. If no reviewer has been named, submit it
anyway: it goes into a queue every supervisor sees, called **Submitted with no reviewer
named**, and someone will pick it up. Do not sit on finished work waiting to be told who
will review it.

## Rework

If it comes back, each review point is listed with a severity. **Must fix** points have
to be answered before you can resubmit. Answer them on the point itself, so the reviewer
can see what you did about each one rather than working it out from the file.

## Time

Log time as you go, on the Time tab. The budget on the deliverable is what it was
expected to take; logging against it is what tells the firm whether the fee was right.
`,
  },

  {
    id: "review",
    title: "Reviewing someone else's work",
    summary: "Review rounds, review points, and what you can and cannot review.",
    minimum: "senior_associate",
    body: `
## What you can review

You can review anything you are named on as reviewer, and you can pick up work in the
unclaimed queue. You cannot review your own work, at any grade. There is no setting for
this and no way round it: it is the single rule that makes a review file mean anything.

## Rounds

**Begin review** opens a round. Everything you raise belongs to that round, so the file
shows how many passes a piece of work took, not just where it ended up.

## Review points

Raise a point for each thing that needs attention, and set the severity honestly:

- **Must fix** blocks the work. The preparer cannot resubmit until it is answered.
- **Should fix** is expected but not blocking.
- **Discussion** is for a question or an observation.

Marking everything must-fix trains people to ignore the distinction, which costs you the
one tool you have for saying "this actually matters".

## Finishing

**Return for rework** sends it back with your points. **Approve** signs it off. A note is
required when you send work back, because "returned for rework" with no explanation is
the least useful thing in the file.
`,
  },

  {
    id: "setting-up",
    title: "Setting work up",
    summary: "Raising deliverables, naming a preparer and a reviewer, reassigning.",
    minimum: "manager",
    body: `
## Raising a deliverable

**Deliverables, New deliverable**, or from a client's own page. The client, a title and a
service line are required; everything else can follow.

Two fields matter more than they look:

- **Assign to (preparer)** is who does the work. Leave it unassigned and nobody has been
  asked to do it.
- **Reviewer** is who checks it. Leaving this at *Assign later* is fine, and common: you
  do not always know in advance. But it must be filled in eventually, and until it is,
  submitted work sits in the unclaimed queue instead of anyone's own list.

Both people are emailed when they are named, and each is told which part is theirs. The
reviewer's message says there is nothing to do yet, because there is not.

## Changing it later

Open the deliverable and press **Change** under Assignment. Whoever is newly named is
told; nobody who was already there is emailed again for a re-save.

The segregation rules still apply here: you cannot make the preparer their own reviewer,
and you cannot name an Associate as a reviewer. The portal refuses with a reason rather
than saving something unworkable.

## The unclaimed queue

**Submitted with no reviewer named** appears on your dashboard whenever it has anything
in it. Treat it as urgent: the preparer has finished, and from their point of view the
work is done and waiting on the firm.
`,
  },

  {
    id: "templates",
    title: "Job templates and the filing calendar",
    summary: "Standard procedures, deadline rules, and generating a year of work.",
    minimum: "manager",
    area: "templates",
    body: `
## What a template holds

The standard procedures for a recurring job, and the rule that works out its statutory
deadline from the period end. Fourteen come with the system, covering the returns a
Ghanaian practice files most often.

## Generating

Pick the template, tick the clients, set the first period end and how many periods. The
portal works out each period's deadline from the rule, and sets an internal target a set
number of days earlier.

Generating is safe to repeat. It will not create a second copy of a job that already
exists for the same client and period, so a run that failed half way can simply be run
again.

## Assignment on a batch

You can name a preparer and a reviewer for the whole run. They each get **one** email
saying how many deliverables were raised, not one per deliverable: a quarter of VAT
returns is a lot of messages, and a person who is flooded stops reading them.
`,
  },

  {
    id: "clients",
    title: "Clients, engagements and client files",
    summary: "The client record, engagements under it, and links to SharePoint.",
    area: "clients",
    body: `
## Clients and engagements

A client is the entity. An engagement is a piece of work you have agreed to do for them,
with its own scope and fee. Deliverables hang off the client, and optionally off an
engagement, which is how you see what a particular engagement actually cost.

## The client file

The **Files** section on a client is a set of links, not a document store. The documents
stay where your firm already keeps them: SharePoint, OneDrive or Google Drive. The portal
holds the address, a title, a category and the period it relates to.

This is on purpose. Two copies of a client's trial balance, one of them stale, is worse
than one copy in the place everybody already looks.

Paste the link from the browser's address bar in SharePoint. The portal works out which
service it is on from the address, and it never opens the link itself: what you can see
is still governed by SharePoint's own permissions.

Removing a link removes the link. The document is untouched.
`,
  },

  {
    id: "requests",
    title: "Client requests",
    summary: "The two public links, and turning an enquiry into a client.",
    minimum: "senior_associate",
    area: "client_requests",
    body: `
## The two links

**Portal settings** issues two addresses: one for people who are not clients yet, and one
for existing clients asking for something further. They differ in what they ask for. Send
the right one; the wrong one asks a stranger for their client code, or asks a client of
ten years for their business all over again.

Anyone with the address can submit, which is the point. If one gets out, **rotate** it:
the old address stops working immediately and you send the new one.

## What arrives

An enquiry, and nothing else. No client record is created, no account, no email
confirmation to the sender. Nothing enters the practice until someone here decides it
should.

## Dealing with one

Open it, read it, and either **accept** it, which creates the client record from what
they told you, or mark it declined with a reason. Either way the enquiry itself stays on
the record, so a decision not to act is as visible as a decision to act.

## The service list

What the forms offer under *What do you need help with?* is yours to set, under
**Portal settings**. Change it whenever the firm's services change.
`,
  },

  {
    id: "reports",
    title: "Reports",
    summary: "Workload, review quality and overdue work across the practice.",
    minimum: "manager",
    area: "reports",
    body: `
## What is there

- **Workload by person**: open deliverables, overdue, in review, budget against logged
  hours.
- **By service line**: where the practice's work and overruns actually are.
- **Review quality by preparer**: how often work is approved without going back.

## Reading the first-pass rate

It is the share of a person's deliverables that were approved without ever being
returned. A low rate is a signal, not a verdict: it can mean training is needed, or that
the budget was never realistic, or that one reviewer marks harder than the others. Ask
before concluding.
`,
  },

  {
    id: "my-records",
    title: "Your own records",
    summary: "Your details, the handbook, and what you have signed.",
    body: `
## Your details

**My details** is yours to maintain: contact details, next of kin, qualifications. Your
job title, grade, start date and pay are not editable by you, because they are the firm's
record of your employment rather than your description of it.

## The handbook

**Employee handbook** holds the firm's policies. Some ask you to acknowledge that you
have read them, and some, your contract in particular, ask for a signature. What you have
signed, and when, is kept: you can always see your own.

## Onboarding

**My onboarding** shows what is left for you to do and what the firm still owes you. The
progress bar counts only the things you can act on yourself.
`,
  },

  {
    id: "people",
    title: "Running the people side",
    summary: "Staff records, onboarding, contracts and pay.",
    minimum: "partner",
    body: `
## The personnel file

**People** is the directory. Each person's file is layered on purpose: employment facts
across management, personal details to the person themselves and to HR, and pay and bank
details to Partners only. That layering is enforced by what the server sends, not by
hiding fields in the browser, so it holds however anyone arrives at the data.

## New staff

**Accounts and grades, New account** creates the account, and can email the invitation
straight away from the firm's own address. You get a temporary password to pass on if you
would rather do it yourself, and the screen tells you plainly whether the email went.

## Contracts

A contract has to be issued per person, so the template is copied for each. On the
document, use **Issue for one person** and pick them: they get their own copy, requiring
their own signature, and their signature is recorded against that copy rather than
against a template everybody shares.

## Pay

Compensation is Partner grade only, and every change is recorded with who made it. There
is no setting that opens this up.
`,
  },

  {
    id: "settings",
    title: "Settings, appearance and who sees what",
    summary: "The firm's identity, the logo, email, visibility and erasing data.",
    minimum: "partner",
    body: `
## Portal settings

Everything the firm controls sits behind one sidebar entry, in tabs:

- **Documents and handbook**: policies and contracts.
- **Welcome message and firm details**: what a new joiner reads first.
- **Logo and colours**: two logo slots, one for light backgrounds and one for the navy
  sidebar. Upload a plain single-colour logo with a transparent background and the portal
  can work the second one out for you.
- **Email notifications**: whether the portal can send mail, and a test you can send to
  yourself.
- **Who sees what**: below.
- **Erase data**: below.

## Who sees what

For each area, the lowest grade that can open it. It is enforced by the server as well as
the sidebar, so closing an area actually closes it rather than hiding the link.

Some things are not on that screen and cannot be changed: nobody reviews their own work,
Associates cannot be reviewers, pay is Partner only. Those are what make the review file
worth anything.

## Erasing data

A period of records can be removed: closed deliverables, inbox notifications, the
activity log, old enquiries. It always previews exactly what would go before it goes, it
asks why, and it records the erasure itself in a log it cannot erase.

It will never touch staff records, signed documents, clients, or live work. If you need
one of those gone, the answer is not this tool.

Check the preview's warnings. It will tell you when a period reaches into the years a
practice would normally still be able to produce records for.
`,
  },

  {
    id: "trouble",
    title: "When something is not working",
    summary: "The handful of things that actually go wrong, and what to do.",
    body: `
## "I was not emailed"

Three ordinary reasons before you suspect a fault:

1. **You did it yourself.** The portal never emails you about your own action.
2. **You turned it off**, under My account.
3. **You are not involved.** Notifications go to the people on a deliverable: whoever is
   doing it, whoever is reviewing it, whoever raised it, and anyone who has commented.
   Not the whole firm.

If none of those fit, a Partner can check **Portal settings, Email notifications** and
send themselves a test. It reports exactly what the mail provider said.

## "I finished it but nothing happened"

Check whether a reviewer is named. If not, it is in the unclaimed queue rather than a
person's list. That is visible to every supervisor, but nobody is individually on the
hook for it, so say something as well.

## "The button I need is not there"

The portal only offers actions the rules allow from the current state, by your grade, on
that deliverable. The most common cases are trying to review your own work, and trying to
act on something at a state that does not allow it, such as approving work that has not
been submitted.

## "I cannot see a screen I could see before"

A Partner may have changed who sees what. Ask them, rather than assuming something broke.

## "My password stopped working"

If you were given a temporary one, it works only until you set your own, and it confines
the account until you do. Set a password and everything opens up.
`,
  },
];

/** The sections a given reader should be offered, in order. */
export function guideFor(role: Role, canSee: (area: Area) => boolean): GuideSection[] {
  return GUIDE.filter((section) => {
    if (section.minimum && ROLE_RANK[role] < ROLE_RANK[section.minimum]) return false;
    if (section.area && !canSee(section.area)) return false;
    return true;
  });
}
