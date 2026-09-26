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
it will let you do anything else.

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
    id: "two-step",
    title: "Two-step sign-in",
    summary:
      "The code from your phone, remembering a device, and what to do if you lose it.",
    body: `
## Setting it up

**My account**, then **Set up two-step sign-in**. Three steps:

1. Scan the square with an authenticator app. Google Authenticator, Microsoft
   Authenticator, Authy, 1Password and Bitwarden all work. If the camera will not
   cooperate, press **Show the key** and type it in instead.
2. Enter the six-digit code the app now shows.
3. Save the ten recovery codes.

## The recovery codes

Ten codes, each of which works once. They are shown when you finish setting up and never
again, so save them then.

Keep them somewhere that is not the phone with the app on it. A password manager, or
paper in a locked drawer. Both on the same phone is one lost phone away from having no
way in.

## Signing in from then on

Your password, then the code. Five wrong codes and the attempt is abandoned; start again
from your email and password.

## Remembering a device

Tick **Remember this device** when you enter your code and you will not be asked for one
again in that browser for thirty days, unless the firm has set a different number.

Two things worth knowing:

- It only works when you signed in with a code from the app. A recovery code or your
  security questions will not remember a device.
- It is that browser on that machine, not you. A different browser, a private window, or
  clearing your cookies means being asked again.

Only tick it on a machine that is yours. Not a client's, and not a shared one.

**My account** lists every device you have remembered, when each was last used and when
it runs out, and lets you forget any of them or all at once. Do that if a laptop is lost.

## If you cannot reach your phone

Two ways back in, and which you have depends on what you set up.

**A recovery code.** Choose **I do not have my phone** and use one of the ten.

**Your security questions**, if the firm has these switched on and you have set yours.
Choose at least three under **My account**. You are asked all of them at once, and every
answer has to match.

They are a way back in, not another way to sign in. They will not remember a device, and
using them tells every Partner.

Pick questions whose answers are not on your CV, your HR record, or anywhere public.

## If a code is refused

Almost always the phone's clock. An authenticator works from the time, so a phone whose
clock has drifted a minute produces codes the portal will not accept. Set the clock to
update automatically and try again.

## If you lose your phone and your codes

A Partner resets your two-step sign-in and you set it up again on the new phone. Expect a
phone call to a number they already had, not an email exchange.

## Being signed out when you step away

The portal signs you out after a spell with no activity, ten minutes unless the firm has
changed it.

You get a warning first, with a countdown and a **Stay signed in** button. Take it if you
were part-way through writing something: anything typed and not saved goes with the
session.

Typing, clicking and scrolling all count as activity. Reading a long document without
touching anything does not, which is exactly when the warning matters.
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
allowed to press are shown, so if one you expect is missing, the rules do not allow it.

## Procedures

The checklist on a deliverable is the firm's method for that job. Items marked
**mandatory** must be ticked before it can be submitted.

## Submitting

**Submit for review** hands it to the reviewer. If no reviewer has been named, submit it
anyway: it goes into a queue every supervisor sees, and someone will pick it up. Do not
sit on finished work waiting to be told who will review it.

## Rework

If it comes back, each review point is listed with a severity. **Must fix** points have
to be answered before you can resubmit. Answer them on the point itself, so the reviewer
can see what you did about each one rather than working it out from the file.

## Time

Log time as you go, on the Time tab. The budget on the deliverable is what the job was
expected to take.
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
this.

## Rounds

**Begin review** opens a round. Everything you raise belongs to that round, so the file
shows how many passes the work took.

## Review points

Raise a point for each thing that needs attention, and set the severity honestly:

- **Must fix** blocks the work. The preparer cannot resubmit until it is answered.
- **Should fix** is expected but not blocking.
- **Discussion** is for a question or an observation.

Marking everything must-fix trains people to ignore the distinction.

## Finishing

**Return for rework** sends it back with your points. **Approve** signs it off. A note is
required when you send work back.
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

Both people are emailed when they are named, and each is told which part is theirs.

## Changing it later

Open the deliverable and press **Change** under Assignment. Whoever is newly named is
told; nobody who was already there is emailed again for a re-save.

You cannot make the preparer their own reviewer, and you cannot name an Associate as a
reviewer. The portal refuses with a reason.

## The unclaimed queue

**Submitted with no reviewer named** appears on your dashboard whenever it has anything
in it. The preparer has finished and is waiting on the firm, so treat it as urgent.
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

Generating is safe to repeat: it will not create a second copy of a job that already
exists for the same client and period.

## Assignment on a batch

You can name a preparer and a reviewer for the whole run. They each get one email saying
how many deliverables were raised, rather than one per deliverable.
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

Paste the link from the browser's address bar in SharePoint. The portal never opens the
link itself, so what you can see is still governed by SharePoint's own permissions.

Removing a link removes the link. The document is untouched.
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
returned. A low rate can mean training is needed, that the budget was never realistic, or
that one reviewer marks harder than the others. Ask before concluding.
`,
  },

  {
    id: "my-records",
    title: "Your own records",
    summary: "Your details, the handbook, and what you have signed.",
    body: `
## Your details

**My details** is yours to maintain: contact details, next of kin, qualifications. Your
job title, grade, start date and pay are the firm's record and are not editable by you.

## The handbook

**Employee handbook** holds the firm's policies. Some ask you to acknowledge that you
have read them; your contract asks for a signature. What you have signed, and when, is
kept, and you can always see your own.

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

**People** is the directory. Each person's file is layered: employment facts across
management, personal details to the person themselves and to HR, and pay and bank details
to Partners only.

## New staff

**Accounts and grades, New account** creates the account, and can email the invitation
straight away from the firm's own address. You get a temporary password to pass on if you
would rather do it yourself, and the screen tells you plainly whether the email went.

## Contracts

A contract is issued per person, so the template is copied for each. On the document,
use **Issue for one person** and pick them. They get their own copy, with the
placeholders filled in from their record.

## Pay

Compensation is Partner grade only, and every change is recorded with who made it.
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
- **Contract terms and reporting**: the standard terms that go into every contract, and
  which days status reports are due.
- **Email notifications**: whether the portal can send mail, and a test you can send to
  yourself.
- **Who sees what**, **Sign-in security** and **Erase data**: below.

## Sign-in security

Three things, on one screen.

**Sign out after inactivity.** How long a session may sit untouched before it ends. Ten
minutes by default. Everyone gets a warning with a countdown and a button to stay signed
in. Set it to *Never* if the firm would rather not have it.

**Who must use two-step sign-in.** The lowest grade obliged to use it. The default is
Partner and above. Anyone below the line may still choose to use it.

Nobody is locked out by turning this on. Someone who is required to use it and has not
set it up can still sign in, and is then confined to their own account screen until they
do.

The same screen lists where everyone stands, and lets you **reset** somebody whose phone
is lost along with their recovery codes. Two things about that:

- You cannot reset your own. Use a recovery code, or ask another Partner.
- Satisfy yourself the person asking is really them first. A phone call you placed to a
  number you already had is the usual test. A request by email is not.

**Remembered devices and security questions.** Whether people may tick *Remember this
device*, and for how long - thirty days by default, ninety at most - and whether security
questions are offered as a way back in.

Questions are a recovery route only, never a way to sign in and never a way to remember a
device. They are weaker than the app, so they are off unless the firm turns them on.

## Who sees what

For each area, the lowest grade that can open it. It is enforced by the server as well as
the sidebar, so closing an area actually closes it rather than hiding the link.

Separately from that, staff below Manager grade see only their own work: the deliverables
they prepare or review, and the clients those belong to. That is not on this screen and
cannot be opened up.

Some other things are fixed too: nobody reviews their own work, Associates cannot be
reviewers, and pay is Partner only.

## Erasing data

A period of records can be removed: closed deliverables, inbox notifications, the
activity log, old enquiries. It previews exactly what would go before it goes, asks why,
and records the erasure in a log it cannot erase.

It will never touch staff records, signed documents, clients, or live work.

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

If none of those fit, a Partner can check **Portal settings, Email notifications** and
send themselves a test.

## "I finished it but nothing happened"

Check whether a reviewer is named. If not, it is in the unclaimed queue rather than a
person's list. Every supervisor sees that queue, but nobody is individually on the hook
for it, so say something as well.

## "The button I need is not there"

The portal only offers actions the rules allow from where the deliverable is now, at your
grade. Most often it is reviewing your own work, or acting on something at a state that
does not allow it - approving work that has not been submitted, say.

## "I cannot see a client or a deliverable I expected"

Below Manager grade you see the deliverables you prepare or review, and the clients those
belong to. If something you worked on has been reassigned, it leaves your list.

If a whole screen has gone, a Partner may have changed who sees what. Ask them.

## "I keep being signed out"

The portal ends a session after a spell of no activity, ten minutes unless your firm has
changed it. If it is happening while you are working, you are probably reading rather than
typing: scrolling counts as activity, sitting still with a document open does not.

A Partner can lengthen the period or switch it off under **Portal settings, Sign-in
security**.

If it happens the instant you sign in, tell a Partner. That usually means a clock
somewhere is badly wrong.

## "It will not accept my code"

Almost always the phone's clock. An authenticator works from the time of day, so a phone
set by hand that has drifted produces codes the portal refuses. Set the clock to update
automatically.

If it still refuses, check the app is showing the entry for this portal rather than
another system, and that you finished setting it up - a setup you started and did not
confirm is not in force.

## "I am being asked for a code on a device I told it to remember"

Remembering is per browser, so a different browser, a private window, or cleared cookies
means being asked again. It also runs out after thirty days, and it never applies when you
last signed in with a recovery code or your security questions.

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
