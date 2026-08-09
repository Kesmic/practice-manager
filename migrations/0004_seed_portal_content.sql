-- Firm settings and a starting employee handbook.
--
-- IMPORTANT: the policies below are drafting starting points written to be
-- edited, not finished legal instruments. Every one of them must be reviewed
-- against the employment law and professional standards that apply to the firm
-- before it is published to staff. They are seeded as DRAFT for exactly that
-- reason — nothing here reaches an employee until a partner publishes it.

INSERT INTO settings (key, value, updated_at) VALUES
  ('firm_name', 'Kesmic Consulting', datetime('now')),
  ('firm_website', 'https://www.kesmic.org', datetime('now')),
  ('md_name', '', datetime('now')),
  ('md_title', 'Managing Director', datetime('now')),
  ('welcome_message',
   '## Welcome to the firm

I am delighted you have joined us.

We are a practice built on technical rigour and the trust our clients place in
us. Every return we file, every set of accounts we prepare and every opinion we
give carries our name, and clients rely on it to make decisions that matter to
their businesses. That is a responsibility I take seriously, and I am asking you
to take it seriously too.

What I ask of you is straightforward. Do careful work. Ask when you are not
sure, because asking early is always cheaper than correcting late. Meet the
deadlines you commit to, and tell someone as soon as you know you cannot.
Protect what our clients tell us in confidence, without exception.

What you can expect in return is honest feedback, real responsibility as soon
as you are ready for it, and support in becoming professionally qualified. You
will be reviewed by people whose job is to make your work better, not to catch
you out. Use them.

Please work through your onboarding steps below. Read your contract and the
handbook properly rather than clicking through them. If anything is unclear,
come and find me.

Welcome aboard.',
   datetime('now'));

-- ---------------------------------------------------------------------------
-- Handbook policies (seeded as drafts, requiring acknowledgement once published)
-- ---------------------------------------------------------------------------

INSERT INTO documents
  (id, kind, category, title, summary, body, version, status,
   requires_signature, requires_acknowledgement, audience, position,
   created_at, updated_at)
VALUES
  ('pol_conduct', 'policy', 'Professional conduct',
   'Code of Conduct and Ethics',
   'The standards of behaviour and professional judgement expected of everyone in the firm.',
   '## Purpose

This code sets out how we expect every member of the firm to behave, towards
clients, towards each other and towards the regulators and authorities we deal
with.

## The fundamental principles

We follow the fundamental principles of the professional accountancy bodies:

- **Integrity** — be straightforward and honest in all professional and business
  relationships. Never be associated with a report, return or communication that
  you believe contains a materially false or misleading statement.
- **Objectivity** — do not allow bias, conflict of interest or undue influence
  to override professional judgement.
- **Professional competence and due care** — maintain the knowledge and skill
  the work requires, and act diligently in accordance with applicable technical
  and professional standards.
- **Confidentiality** — respect the confidentiality of information acquired
  through professional relationships.
- **Professional behaviour** — comply with relevant laws and regulations, and
  avoid conduct that discredits the profession.

## In practice

- Do not sign, submit or approve work you have not actually reviewed.
- Record time honestly, against the engagement the work was done for.
- Raise concerns about a client, a colleague or a piece of work through your
  line manager or directly with a partner. Concerns raised in good faith will
  never be held against the person raising them.
- If you become aware of an error in work already issued, report it immediately.
  Concealing an error is treated far more seriously than making one.

## Breach

Breach of this code may result in disciplinary action up to and including
dismissal, and where a professional body is involved, referral to it.',
   1, 'draft', 0, 1, 'all', 1, datetime('now'), datetime('now')),

  ('pol_confidentiality', 'policy', 'Professional conduct',
   'Client Confidentiality and Data Protection',
   'How client information must be handled, stored and shared.',
   '## The obligation

Everything you learn about a client through your work is confidential. This
obligation applies during your employment and continues indefinitely after it
ends. It applies to the existence of an engagement, not only its contents.

## What this means day to day

- Do not discuss client matters in public places, on public transport, or in
  shared offices where you can be overheard.
- Do not discuss one client with another, and do not tell a client who else we
  act for.
- Client data stays on firm systems. Do not copy working papers to personal
  email, personal cloud storage or removable drives.
- Lock your screen when you leave your desk. Do not leave papers containing
  client information on desks overnight.
- Send client information only to the contacts authorised on the engagement.
  Check the recipient before attaching anything.
- Report any suspected loss or unauthorised disclosure of client data to a
  partner immediately, the same day. Early reporting limits the damage.

## Disclosure to third parties

Client information may only be disclosed outside the firm where the client has
authorised it, where there is a legal or professional duty to disclose, or where
disclosure is required by a regulator or court. If you receive such a request,
do not respond to it yourself — pass it to a partner.

## Personal data

Where we hold personal data, we process it only for the purpose it was provided
for, keep it no longer than necessary, and protect it appropriately. Requests
from individuals about their own data must be passed to a partner promptly, as
statutory response deadlines apply.',
   1, 'draft', 0, 1, 'all', 2, datetime('now'), datetime('now')),

  ('pol_independence', 'policy', 'Professional conduct',
   'Independence and Conflicts of Interest',
   'Identifying and managing threats to objectivity, including on audit engagements.',
   '## Why this matters

Our opinions are worth something only because we are independent of the people
we give them about. Independence is both a state of mind and the absence of
circumstances that a reasonable observer would think compromises it.

## Your obligations

- Declare any financial interest you or a close family member holds in a client.
- Declare any close personal or family relationship with a client, a client
  director or a client employee in a position of influence.
- Declare any offer of employment from a client.
- Do not accept gifts or hospitality from a client beyond a modest and clearly
  inconsequential value. If in doubt, declare it and ask.
- Do not hold a position on the board or in the management of a client.
- Complete the annual independence declaration when it is issued to you.

## Audit engagements

On audit and other assurance engagements the requirements are stricter. You must
not work on an audit where you have any financial interest in the client, where
you have a close relationship with someone in a position of influence, or where
you have recently been employed by the client. Rotation requirements apply to
long association with an audit client.

## Conflicts between clients

Where acting for two clients could put us on both sides of the same matter, the
engagement cannot proceed without partner assessment, and in some cases cannot
proceed at all. Client acceptance procedures include a conflict check for this
reason. If you become aware of a conflict after acceptance, report it at once.',
   1, 'draft', 0, 1, 'all', 3, datetime('now'), datetime('now')),

  ('pol_aml', 'policy', 'Regulatory',
   'Anti-Money Laundering and Counter-Terrorist Financing',
   'Customer due diligence, red flags, and the duty to report suspicion.',
   '## Scope

The firm is subject to anti-money laundering obligations. Every member of staff
has personal responsibility under this policy, and failure to report suspicion
can be a criminal offence for the individual as well as the firm.

## Customer due diligence

No work begins before client acceptance procedures are complete. That includes
verifying the identity of the client, identifying beneficial owners, screening
against sanctions and adverse media, understanding the purpose of the
relationship, and assigning a risk rating. Higher-risk clients require enhanced
due diligence and more frequent review.

Due diligence records must be kept current. Where a client risk rating is high,
refresh the documentation at the interval set for that rating.

## Red flags

Escalate, rather than resolve yourself, anything of this kind:

- Reluctance to provide identification or beneficial ownership information.
- Transactions with no apparent commercial rationale.
- Funds routed through jurisdictions unconnected to the business.
- Unexplained cash, or third parties settling client obligations.
- Requests to structure a transaction so that a reporting threshold is avoided.
- Pressure to complete work without normal documentation.

## Reporting suspicion

If you know or suspect money laundering, report it to the firm Money Laundering
Reporting Officer immediately. Do not investigate it yourself.

**Do not tell the client, or anyone else, that you have made a report.** Doing so
may constitute the offence of tipping off. Any question about whether to report
should be resolved by reporting.',
   1, 'draft', 0, 1, 'all', 4, datetime('now'), datetime('now')),

  ('pol_it', 'policy', 'Working at the firm',
   'IT Security and Acceptable Use',
   'How firm systems, devices and accounts must be used and protected.',
   '## Accounts and access

- Your account is yours alone. Never share your password or work under another
  person account.
- Use a unique, strong password for firm systems and enable multi-factor
  authentication wherever it is offered.
- Report a suspected compromise of your account immediately, even if you are not
  certain.
- Access is granted on the basis of need. Do not attempt to view client files or
  personnel records you have no working reason to see.

## Devices

- Keep operating systems and applications updated.
- Encrypt laptops and any device holding client information.
- Never leave a device unattended in a public place or visible in a vehicle.
- Report loss or theft the same day.

## Email and messaging

- Check recipients before sending anything containing client information.
- Treat unexpected attachments and links with suspicion, including those
  appearing to come from colleagues or clients. Verify by phone if a message
  asks you to change payment details or send information urgently.
- Report phishing attempts rather than simply deleting them.

## Acceptable use

Firm systems are provided for work. Limited personal use is acceptable provided
it is lawful, does not interfere with your work and does not expose the firm to
risk. Do not use firm systems to store or transmit unlawful, discriminatory or
offensive material. Do not install unlicensed software. Do not connect
unapproved cloud services to firm data.

## Monitoring

The firm may monitor use of its systems where there is a legitimate business or
security reason, proportionately and in accordance with applicable law.',
   1, 'draft', 0, 1, 'all', 5, datetime('now'), datetime('now')),

  ('pol_leave', 'policy', 'Working at the firm',
   'Leave and Absence',
   'Annual leave, sick leave, and other absence from work.',
   '## Annual leave

Your annual leave entitlement is stated in your contract of employment. Leave is
taken with the prior approval of your line manager.

When requesting leave, consider the filing calendar. Requests during peak
compliance periods may need to be moved, and the earlier you ask the more likely
it is that we can accommodate you. Before going on leave, hand over open
deliverables and record the position on each so that whoever covers can pick it
up without guessing.

Carry-over of unused leave into the following year is by exception and requires
partner approval.

## Sickness absence

If you are unable to work because of illness, tell your line manager as early as
possible on the first day, and by telephone or message rather than only by email.
Keep them updated. For absence beyond the period stated in your contract, a
medical certificate is required.

Do not work while signed off sick.

## Other absence

- **Compassionate leave** following bereavement or serious family illness is
  granted at the discretion of a partner. Ask, and it will be dealt with
  sympathetically.
- **Study and examination leave** for approved professional qualifications is
  available in accordance with the firm study support arrangements.
- **Statutory leave** entitlements, including maternity, paternity and parental
  leave, apply as provided by law. Speak to a partner as early as you are
  comfortable doing so, so that cover can be planned properly.

## Unauthorised absence

Absence without approval or notification may be treated as a disciplinary
matter.',
   1, 'draft', 0, 1, 'all', 6, datetime('now'), datetime('now')),

  ('pol_working', 'policy', 'Working at the firm',
   'Working Hours, Remote Work and Timekeeping',
   'Core hours, flexibility, and how time is recorded against client work.',
   '## Hours

Standard working hours are stated in your contract. Compliance work is seasonal,
and there will be periods, particularly around filing deadlines and audit
fieldwork, when longer hours are needed. We try to plan around them and to
balance them with quieter periods.

If your workload is not achievable in the hours available, say so early. A
missed deadline discovered late is a far bigger problem than a resourcing
conversation held in time.

## Remote work

Remote and hybrid working is available by agreement with your line manager,
subject to the needs of the engagement. Client site attendance, team review
sessions and training may require you to be present in person.

When working remotely you must be able to work securely and privately: a
connection you control, a screen others cannot read, and somewhere you can take
a client call without being overheard. Working from public wireless networks
without a firm-approved connection is not permitted.

## Timekeeping

Record your time against the correct deliverable, on the day you did the work
or the next working day at the latest. Time records drive client billing,
engagement profitability and our own planning assumptions, so accuracy matters
more than presentation.

Do not record time you have not worked, and do not move time between
engagements to make a budget look better. If a job has overrun its budget, the
overrun is information the firm needs, not something to hide.',
   1, 'draft', 0, 1, 'all', 7, datetime('now'), datetime('now')),

  ('pol_dignity', 'policy', 'People',
   'Equal Opportunity, Dignity at Work and Anti-Harassment',
   'Our commitment to fair treatment, and what to do about unacceptable behaviour.',
   '## Commitment

Appointment, development, reward and promotion at this firm are decided on
merit. We do not discriminate on the basis of sex, age, ethnicity, religion or
belief, disability, marital status, pregnancy, or any other characteristic
protected by applicable law.

## Dignity at work

Everyone is entitled to be treated with respect. Harassment, bullying,
victimisation and intimidation are not tolerated, whether by a colleague, a
manager, a client or a supplier. This includes conduct at work-related social
events and in electronic communications.

Harassment is judged by its effect on the recipient, not by the intent of the
person responsible. Behaviour that one person finds acceptable may reasonably be
unwelcome to another.

## Reasonable adjustments

If you have a disability or health condition affecting your work, tell a partner
so that reasonable adjustments can be considered. Such information is treated
confidentially.

## Raising a concern

If you experience or witness unacceptable behaviour, raise it with your line
manager, or with any partner if that is not appropriate. You may raise a concern
about behaviour towards someone else.

Concerns will be handled confidentially so far as is possible, taken seriously
and investigated. Nobody who raises a concern in good faith will be
disadvantaged for doing so, and retaliation against them is itself a
disciplinary matter.

Where a client behaves unacceptably towards a member of our staff, the firm will
support the member of staff. We are prepared to resign an engagement over it.',
   1, 'draft', 0, 1, 'all', 8, datetime('now'), datetime('now')),

  ('pol_performance', 'policy', 'People',
   'Performance, Review and Professional Development',
   'How work is reviewed, how performance is assessed, and study support.',
   '## Review of your work

Every deliverable you prepare is reviewed by someone more senior before it goes
to a client. Review is a quality control over the work, not a judgement of you.
Expect review points, including on good work.

When you receive review points, respond to each one on the portal, saying what
you changed. If you disagree with a point, say so and explain why — that is a
legitimate and useful response, and reviewers get things wrong too. What is not
acceptable is marking a point as addressed without addressing it.

Repeated review points of the same kind are a signal that we have not trained
you well enough in something. Raise it, and we will fix it.

## Performance assessment

Performance is discussed with your line manager regularly and formally at least
annually. Assessment considers technical quality, reliability against deadlines,
client and colleague relationships, and progress against the development goals
set at the previous review.

Probation is assessed before the probation end date recorded on your employment
record. You will not learn the outcome of probation for the first time on the
day it ends.

## Professional development

The firm supports study towards recognised professional qualifications. Support
typically covers tuition and examination fees and study leave, subject to
agreement in advance and to the conditions in your study agreement.

You are responsible for maintaining any continuing professional development your
professional body requires, and for keeping evidence of it.',
   1, 'draft', 0, 1, 'all', 9, datetime('now'), datetime('now')),

  ('pol_grievance', 'policy', 'People',
   'Grievance and Disciplinary Procedure',
   'How concerns are raised and how conduct and capability matters are handled.',
   '## Grievances

If you have a concern about your employment, raise it informally with your line
manager first where you can. Most matters are resolved that way.

If informal discussion does not resolve it, or is not appropriate, put the
grievance in writing to a partner. You will be invited to a meeting to discuss
it, you may be accompanied by a colleague, and you will be given a written
outcome. If you are dissatisfied with the outcome you may appeal to a different
partner, whose decision is final.

## Disciplinary matters

Where there is a concern about conduct or capability, it will be investigated
before any decision is taken. You will be told the nature of the concern, given
the evidence, invited to a meeting to respond, and allowed to be accompanied by
a colleague. You have a right of appeal against any sanction.

Sanctions range from a recorded verbal warning through written warnings to
dismissal, depending on seriousness and any previous warnings.

## Gross misconduct

Some conduct may justify dismissal without notice. Examples include dishonesty,
falsification of records or time, theft, breach of client confidentiality,
deliberate breach of independence requirements, failure to report suspected
money laundering, serious breach of the code of conduct, harassment, and being
unfit for work through alcohol or drugs.

This list is illustrative, not exhaustive.

## Suspension

Suspension on full pay may be used while a serious matter is investigated. It is
a neutral act and not a disciplinary sanction in itself.',
   1, 'draft', 0, 1, 'all', 10, datetime('now'), datetime('now')),

  ('tpl_contract', 'form', 'Contracts',
   'Contract of Employment (template)',
   'Starting point for an individual contract. Copy, complete, and issue to the employee for signature.',
   '## Contract of Employment

This template must be completed for the individual, reviewed against applicable
employment law, and issued as a document addressed to that employee before it is
signed. Replace every bracketed field.

**Between** [FIRM NAME] (the Firm) **and** [EMPLOYEE FULL NAME] (the Employee).

### 1. Position and duties

The Employee is engaged as [JOB TITLE] in the [DEPARTMENT] department, reporting
to [LINE MANAGER]. The Employee will carry out the duties reasonably associated
with that position and such other duties as the Firm may reasonably require.

### 2. Commencement and probation

Employment commences on [START DATE]. The first [PROBATION MONTHS] months are a
probationary period, during which either party may terminate on [PROBATION
NOTICE] notice. Confirmation in post follows a satisfactory probation review.

### 3. Place of work

The normal place of work is [LOCATION]. The Employee may be required to work at
client premises. Hybrid or remote working is available in accordance with firm
policy.

### 4. Hours

Normal working hours are [HOURS] per week, [DAYS]. The nature of professional
practice means additional hours are sometimes required, particularly around
statutory filing deadlines.

### 5. Remuneration

Gross salary of [CURRENCY] [AMOUNT] per annum, payable [FREQUENCY] by bank
transfer, subject to statutory deductions. Salary is reviewed annually, without
any commitment to increase.

### 6. Leave

[DAYS] working days paid annual leave per year in addition to public holidays,
taken with prior approval.

### 7. Confidentiality

The Employee shall not, during or after employment, disclose or use confidential
information of the Firm or of any client, except as required to perform the role
or as required by law. This obligation survives termination without limit in
time.

### 8. Professional conduct and independence

The Employee shall comply with the ethical and independence requirements of the
Firm and of any applicable professional body, and shall complete the
declarations the Firm requires.

### 9. Intellectual property

Work product created in the course of employment belongs to the Firm.

### 10. Termination

After probation, either party may terminate on [NOTICE PERIOD] written notice.
The Firm may terminate without notice for gross misconduct. The Firm may require
the Employee not to attend work during a notice period while remaining on full
pay.

### 11. Policies

The Employee agrees to comply with the policies in the Employee Handbook. Those
policies are not contractual terms and may be amended, and the Firm will notify
the Employee of material changes.

### 12. Entire agreement

This contract supersedes any previous agreement or representation, written or
oral.

---

By signing on the portal, the Employee confirms having read, understood and
agreed to these terms.',
   1, 'draft', 0, 0, 'all', 90, datetime('now'), datetime('now'));
