-- The Associate Consultant Agreement, as a second contract template.
--
-- The portal already seeds a contract of employment template (`tpl_contract`, in
-- 0004_seed_portal_content.sql). This is the other kind of engagement the firm
-- actually uses: an independent professional paid a fixed fee per assigned client,
-- under a contract FOR service rather than a contract OF service.
--
-- It is a second template rather than a variant of the first because the two differ
-- in the thing that matters most about them. An employment contract creates the
-- protections of the Labour Act, 2003 (Act 651); this one is written to establish
-- that those protections do not apply. Nothing good comes of one document that tries
-- to be both, and a firm editing bracketed fields in a hurry should never be one
-- careless deletion away from turning a consultancy into a job.
--
-- Same conventions as the employment template, so it behaves identically in the
-- portal: stored as a `form` under Contracts, left as a DRAFT, and never published to
-- staff. `POST /api/documents/:id/copy-for` makes a copy addressed to one Associate,
-- as a draft requiring signature, which is the record they actually sign. See the
-- comment on that route in worker/routes/documents.ts.
--
-- Seeded as a draft for the same reason as everything else here: it is a drafting
-- starting point, not a finished legal instrument, and it must be reviewed against
-- Ghanaian law before anybody is asked to sign it. The template carries its own
-- notes to whoever completes it, including what the firm has to change about its
-- onboarding before an Associate is put through it - the standard programme asks a
-- new joiner to sign a contract of employment and acknowledge the employee handbook,
-- which for a contractor is evidence against the arrangement the contract describes.
--
-- Markdown, like every other document body, rendered to React elements by
-- src/components/Markdown.tsx. That renderer has no table support, so the fee tiers
-- and the onboarding terms - tables in the source framework document - are written
-- as lists here. A pipe table would render as literal text.

INSERT INTO documents
  (id, kind, category, title, summary, body, version, status,
   requires_signature, requires_acknowledgement, audience, position,
   created_at, updated_at)
VALUES
  ('tpl_associate_contract', 'form', 'Contracts',
   'Associate Consultant Agreement (template)',
   'Starting point for an independent contractor engagement - a contract FOR service, not employment. Copy, complete, and issue to the Associate for signature.',
   '## Associate Consultant Agreement

**This is a contract FOR service. It is not a contract of service, and the person
engaged under it is not an employee.** That distinction is the point of this
document, and it has to survive contact with how the engagement is actually run -
see the note at the end of this template before you issue it.

This template must be completed for the individual and reviewed against Ghanaian
law before it is issued for signature. Replace every bracketed field.

**Between** [FIRM NAME] of [FIRM ADDRESS] (the Firm) **and** [ASSOCIATE FULL NAME]
of [ASSOCIATE ADDRESS], TIN [ASSOCIATE TIN] (the Associate).

**Commencing** [COMMENCEMENT DATE].

## 1. Purpose and nature of this engagement

The Firm engages the Associate as an independent professional to deliver the
Firm''s All-in-One Accounting, Payroll, Tax and Regulatory Subscription Service
(the Service) to assigned clients.

This engagement is an independent contractor arrangement - a contract for service
- and is expressly not a contract of service. The practical consequences are:

- **No employment relationship.** The Associate is not an employee of the Firm.
  The protections of the Labour Act, 2003 (Act 651) that apply to employees -
  notice pay, severance, redundancy pay, paid leave and other employment
  entitlements - do not apply to this engagement.
- **No statutory employment benefits.** The Firm shall not make SSNIT Tier 1 or
  Tier 2 contributions on the Associate''s behalf, and shall not operate PAYE on
  payments to the Associate. The Associate is responsible for their own tax and
  pension arrangements.
- **Payment for deliverables, not for time.** The Associate is remunerated by
  fixed service fees per assigned client engagement, tied to outputs and
  deliverables. There is no salary and no payment for hours worked.
- **Autonomy in method.** The Associate determines how, when and where to perform
  the services, subject only to the deliverables, deadlines and quality standards
  set out here and in each client''s scope.
- **Freedom to take other work.** The Associate may work for other parties,
  provided that doing so creates no conflict of interest and breaches none of the
  obligations in section 10.

In plain language: the Associate runs their own practice. The Firm assigns client
engagements, pays a fixed monthly fee per client, and holds the Associate to the
deliverables. How the work is organised is the Associate''s own affair - what
matters is that every deliverable is met, on time, to standard.

## 2. The role

The Associate is assigned one or more client accounts subscribed to the Service.
For every assigned client the Associate takes full ownership of delivery, end to
end, across all four pillars of the Service. The clients assigned at commencement
are listed in Schedule 1.

### Accounting and bookkeeping

- Day-to-day capture of transactions in the client''s cloud accounting tool
  ([ACCOUNTING PLATFORM], or as applicable to the client).
- Bank and mobile money reconciliations.
- Accounts payable and receivable management.
- Monthly management accounts - profit and loss, balance sheet and cash flow -
  delivered within the agreed reporting deadline each month.
- Preparation of year-end financial statements to review-ready standard.

### Payroll

- Monthly payroll computation for the client''s staff: gross to net, allowances
  and deductions.
- PAYE computation and electronic filing with the GRA.
- SSNIT Tier 1 and Tier 2 schedules, filings and payment coordination.
- Issue of payslips and maintenance of payroll records.

### Tax compliance

- Monthly VAT, NHIL, GETFund and COVID Levy computations and filings, where
  applicable.
- Withholding tax computations, certificates and filings.
- Quarterly corporate income tax instalments and annual returns.
- First-line handling of routine GRA queries for the assigned client, escalating
  complex matters to the Team Lead.

### Regulatory

- Tracking and execution of every filing on the client''s compliance calendar:
  annual returns, beneficial ownership, business operating permit renewals, data
  protection renewals and any applicable sector filings.
- Timely escalation of any regulatory risk or missed-deadline exposure to the
  Team Lead.

### Client relationship

- Acting as the client''s day-to-day point of contact for routine matters.
- Responding to client queries within the agreed service-level window, being one
  working day unless the client''s scope says otherwise.
- Conducting client visits as required under section 5.
- Maintaining complete, orderly working-paper files for every deliverable.

## 3. Reporting and oversight

The Associate has autonomy over how the work is performed. Delivery is
coordinated through the Firm''s quality and reporting structure:

- **Team Lead.** The Associate reports on deliverables to [TEAM LEAD NAME], who
  reviews outputs, gives technical guidance, signs off client-facing reports and
  filings, and is the escalation point for complex or contentious matters.
- **Weekly status update.** A short written update per assigned client, covering
  work completed, upcoming deadlines and any issues or risks.
- **Monthly delivery review.** At each month end the Team Lead confirms that all
  deliverables for each assigned client are complete to standard. That
  confirmation releases the monthly service fee for that client under section 4.
- **Quality standards.** All work must comply with applicable professional
  standards, including IFRS for SMEs where relevant, with Ghanaian tax and
  regulatory law, and with the Firm''s own quality-control procedures and
  templates.

The Team Lead''s role is quality assurance of deliverables - verifying that
outputs meet professional and contractual standards. It is not day-to-day
supervision of the Associate''s working hours, location or methods, which remain
the Associate''s own.

## 4. Service fees

### 4.1 Fee model

The Associate is paid a fixed monthly service fee per assigned client, set by
that client''s subscription tier. The fee covers the full scope of deliverables
for that client for the month. There is no base salary: monthly earnings are the
sum of the fees for the clients assigned.

The tier rates at the date of this agreement are:

- **Starter** - GHS [STARTER FEE] per client per month. Typical profile: 1 to 5
  staff, low transaction volume.
- **Growth** - GHS [GROWTH FEE] per client per month. Typical profile: 6 to 25
  staff, moderate complexity.
- **Enterprise** - GHS [ENTERPRISE FEE] per client per month. Typical profile: 26
  or more staff, high volume or multi-entity.

By way of illustration, an Associate assigned two Starter clients, one Growth
client and one Enterprise client would invoice for the sum of those four fees in
that month, subject to all deliverables being confirmed by the Team Lead.

### 4.2 Payment terms

- Fees are payable monthly in arrears, on the Team Lead''s confirmation that the
  month''s deliverables are complete to standard.
- The Associate submits a monthly invoice itemising the assigned clients and the
  applicable fees. The Firm pays valid invoices within [PAYMENT DAYS] working
  days of receipt.
- Where a client is onboarded or exits part-way through a month, that client''s
  fee is pro-rated daily.
- Where deliverables for a client are materially incomplete in a month for
  reasons attributable to the Associate, the Firm may withhold that client''s fee,
  in whole or in part, until they are completed. Delays attributable to the
  client or to the Firm do not reduce the fee.
- The Firm shall deduct withholding tax on fees at the rate prescribed for
  services under the Income Tax Act, 2015 (Act 896), and shall furnish the
  Associate with the corresponding withholding tax credit certificate.

### 4.3 The Associate''s own tax and statutory position

- The Associate is solely responsible for registering with the GRA, filing their
  own income tax returns and settling their own liabilities, with credit for tax
  withheld at source.
- No employer pension contribution applies. The Associate is encouraged to make
  their own arrangements, such as a Tier 3 personal pension.
- The Associate provides their own tools of trade - laptop, phone and internet -
  except where the Firm expressly provides software licences or client-system
  access.

### 4.4 Fee review

Tier rates are reviewed at least annually. Any revision is notified in writing
and applies prospectively from the effective date stated in the notice. Fee
changes never apply retroactively to work already performed.

## 5. Working arrangements

### 5.1 Flexible and remote by default

The engagement is flexible and predominantly remote. The Associate sets their own
hours, methods and location, provided that:

- Every deliverable and statutory deadline for each assigned client is met
  without exception.
- The Associate is reasonably reachable during normal Ghana business hours, being
  9:00 am to 5:00 pm Monday to Friday, for client queries and Team Lead
  coordination.
- The Associate attends scheduled check-ins, reviews and training sessions, which
  may be virtual.

### 5.2 In-person client visits

Some client situations require physical presence: document collection, system
setup, stock counts, payroll verification, regulator meetings, or simply building
the relationship. The Associate shall visit assigned clients in person where
reasonably required for proper delivery of the Service.

### 5.3 Onboarding phase for newly signed clients

The first months of a new client engagement are the ones that decide whether it
works. Records must be gathered and cleaned, systems configured, processes
established and trust built. Accordingly, for every newly signed client assigned
to the Associate:

- **Duration** - the first [ONBOARDING MONTHS] months from the client''s
  engagement commencement date.
- **Visit requirement** - a minimum of [ONBOARDING VISITS] in-person visits to
  the client''s premises per week.
- **Purpose** - records collection and cleanup, system setup and training,
  process design, relationship building, and resolving onboarding issues.
- **Travel subsidy** - GHS [TRAVEL SUBSIDY] per month per onboarding client, for
  the duration of the onboarding phase, payable with the monthly service fee and
  conditional on the visit requirement being met and evidenced in the weekly
  status updates.
- **After onboarding** - visit frequency reverts to as needed, at the Associate''s
  professional judgement in consultation with the Team Lead.

### 5.4 Capacity and additional assignments

- Assignments are made by the Firm on the basis of the Associate''s capacity,
  competence and proximity to the client.
- The Associate may decline a new assignment where accepting it would compromise
  delivery on existing assignments. Declining on that basis is expected
  professional behaviour and is not a breach.
- The Associate shall not subcontract or delegate any part of an assignment
  without the Firm''s prior written consent.

## 6. Eligibility and onboarding of the Associate

The Associate confirms that they have provided, or will provide before the first
assignment begins:

- A relevant qualification in accounting, finance or a related field - a degree,
  HND, or a professional qualification or part-qualification such as ICAG, ACCA
  or CIMA.
- Demonstrable practical experience in bookkeeping, payroll or tax compliance.
- Working proficiency with at least one cloud accounting platform.
- A valid TIN and Ghana Card, and evidence of GRA registration.
- Their own laptop, smartphone and reliable internet connectivity.
- Two professional references.

Before the first assignment the Associate will complete induction on the Firm''s
delivery methodology, templates, quality-control procedures and client
communication standards, and will be given systems access for assigned accounts.

## 7. Performance and quality standards

Performance is assessed on deliverables, not hours. The standards are:

- **Statutory deadlines** - no missed statutory filing with the GRA, SSNIT, the
  Registrar or any regulator for an assigned client, except where the delay is
  attributable to the client and was escalated in advance.
- **Management reports** - monthly management accounts delivered to the client
  within [REPORTING DAYS] working days of month end.
- **Client responsiveness** - routine client queries acknowledged within one
  working day.
- **Quality of output** - work passes Team Lead review with no material errors.
  Recurring material errors trigger remediation.
- **Working papers** - complete, referenced working-paper files maintained for
  every deliverable in the Firm''s document system.
- **Onboarding visits** - the minimum weekly visits during a client''s onboarding
  phase, logged in the weekly status update.
- **Professional conduct** - full compliance with section 11 at all times.

Where a deliverable falls short, the Team Lead documents the shortfall and agrees
a remediation plan with the Associate. Persistent or material failure may lead to
reassignment of clients, suspension of new assignments, or termination under
section 9.

## 8. Client assignment, reassignment and transitions

- The Firm retains sole discretion over the assignment and reassignment of
  clients among Associates, guided by capacity, competence, client preference and
  business need.
- Where a client changes subscription tier, the fee for that client moves to the
  new tier rate from the effective date of the change.
- Where a client terminates their subscription, the fee for that client ceases
  from the termination date, pro-rated for the final month, and the Associate
  shall complete an orderly handover of files and records.
- Where a client is reassigned away from the Associate, the Associate shall hand
  over all working papers, credentials and client knowledge within [HANDOVER
  DAYS] working days, and shall be paid pro rata to the handover date.
- The Associate shall report to the Team Lead immediately any client
  dissatisfaction, complaint or circumstance that could jeopardise the client
  relationship.

## 9. Term and termination

The engagement commences on the date stated at the head of this agreement and
continues on a rolling basis until terminated under this section.

- **For convenience, by either party** - on [NOTICE DAYS] days'' written notice,
  to allow an orderly client handover.
- **For cause, by the Firm** - with immediate effect on material breach,
  including fraud, dishonesty, breach of confidentiality, professional
  misconduct, repeated material quality failure after remediation, or conduct
  prejudicial to the Firm or its clients.
- **Where no clients are assigned** - if the Associate has had no assigned client
  for a continuous period of [DORMANT DAYS] days, either party may terminate on
  seven days'' notice.

On termination:

- The Associate is paid all fees earned and unpaid to the effective date, subject
  to completing the handover obligations.
- The Associate shall return or destroy, as directed, all Firm and client
  materials, and shall relinquish all system access.
- The obligations in section 10 survive termination.

## 10. Confidentiality, non-circumvention and intellectual property

### 10.1 Confidentiality

The Associate shall keep strictly confidential all client information, and all of
the Firm''s methodologies, pricing, templates and other non-public information
encountered during the engagement. This obligation survives termination
indefinitely for client information, and for [BUSINESS CONFIDENTIALITY YEARS]
years for the Firm''s business information.

### 10.2 Data protection

The Associate shall handle all personal data strictly within Firm-approved
systems and in compliance with the Data Protection Act, 2012 (Act 843). Client
data shall never be stored on a personal or unapproved device or account.

### 10.3 Non-circumvention

During the engagement and for [NON-CIRCUMVENTION MONTHS] months after it ends,
the Associate shall not, directly or indirectly, provide accounting, payroll, tax
or regulatory services to any client of the Firm to whom the Associate was
assigned or introduced, except through the Firm. Breach entitles the Firm to
recover, as liquidated damages, an amount equal to [LIQUIDATED DAMAGES MONTHS]
months of that client''s subscription fee, without prejudice to any other remedy.

### 10.4 Non-solicitation

During the engagement and for [NON-SOLICITATION MONTHS] months afterwards, the
Associate shall not solicit or induce any of the Firm''s personnel, associates or
clients to end their relationship with the Firm.

### 10.5 Intellectual property

All templates, methodologies, working papers, systems and materials provided by
the Firm remain the Firm''s exclusive property. All working papers and
deliverables produced by the Associate on an assignment are the property of the
Firm and, where applicable, of the client, and are licensed to the Associate only
for the purpose of performing that assignment.

### 10.6 Conflicts of interest

The Associate shall promptly disclose any actual or potential conflict of
interest, including any personal, family or financial relationship with an
assigned client, and any engagement with a competing service provider.

## 11. Code of conduct

In everything connected with this engagement the Associate shall:

- Act with integrity, objectivity, professional competence, due care and
  confidentiality, consistent with the ethical standards of the accounting
  profession.
- Never hold, receive or handle client funds or client tax money in a personal
  account, under any circumstance.
- Never accept gifts, payments or favours from a client beyond modest customary
  hospitality, and never solicit any payment from a client directly.
- Represent the Firm professionally in appearance, communication and punctuality
  in all client interactions.
- Never make a commitment on scope, pricing or outcome on the Firm''s behalf
  without authorisation.
- Report immediately any suspected fraud, money laundering or illegal activity
  encountered at a client, in line with applicable law and the Firm''s procedures.
- Comply with all applicable laws of the Republic of Ghana.

## 12. General

- **Independent contractor status.** Nothing in this agreement or in the conduct
  of the parties creates an employment relationship, partnership or agency beyond
  the limited scope expressly authorised. The Associate shall not hold themselves
  out as an employee of the Firm.
- **Professional indemnity.** The Firm maintains professional oversight of client
  deliverables through the Team Lead review structure. The Associate shall notify
  the Firm promptly of any claim, complaint or circumstance that could give rise
  to liability.
- **Non-exclusivity.** The engagement is non-exclusive on both sides. The Firm
  may engage other associates, and the Associate may serve their own clients,
  subject to sections 10.3 and 10.6 and to confidentiality.
- **Variation.** Any variation is valid only if made in writing and agreed by
  both parties.
- **Entire agreement.** This agreement and its schedules are the entire agreement
  between the parties.
- **Governing law.** This engagement is governed by the laws of the Republic of
  Ghana. The parties submit to the jurisdiction of the courts of Ghana, subject
  first to good-faith negotiation and mediation of any dispute.
- **Severability.** If any provision is held invalid or unenforceable, the rest
  continues in full force.

## Schedule 1 - Clients assigned at commencement

- [CLIENT NAME] - [TIER] tier - GHS [FEE] per month - onboarding phase [YES/NO].
- [CLIENT NAME] - [TIER] tier - GHS [FEE] per month - onboarding phase [YES/NO].

Clients may be added or removed under section 8 without varying the rest of this
agreement.

---

By signing on the portal, the Associate confirms having read, understood and
agreed to these terms, and confirms that the TIN and address recorded above are
correct.

---

### Before you issue this - notes for whoever completes it

Delete this section before publishing the contract to the Associate.

**This is a contract for service, and the portal is built around employment.**
The strength of the independent-contractor characterisation rests on what the
Firm actually does, not on what this document says. Two things in the portal cut
against it, and both need a decision before an Associate is onboarded through it:

- The standard onboarding programme asks every new joiner to sign a *contract of
  employment*, acknowledge the *Employee Handbook* policy by policy, register for
  payroll and statutory deductions, and have probation objectives set. Applied to
  an Associate, each of those is a fact a tribunal would weigh against the Firm.
  Remove or replace those steps on an Associate''s onboarding checklist.
- The Employee Handbook is written for employees. If an Associate is to be bound
  by any of it, bind them through this agreement - section 11 already carries the
  conduct obligations - rather than by asking them to acknowledge employment
  policies.

Set the Associate''s employment type to **Consultant** on their HR record, and
leave the salary fields on the compensation record empty: an Associate is paid by
invoice against this agreement, not through payroll.

**Have this reviewed.** Like every document seeded with this system, it is a
drafting starting point, not a finished legal instrument. The independent
contractor characterisation, the withholding tax rate, the liquidated damages
clause in section 10.3 and the restraint periods in sections 10.3 and 10.4 are
the clauses most likely to be tested, and the last three are the ones a Ghanaian
court is most likely to read down if they are drawn too wide.',
   1, 'draft', 0, 0, 'all', 91, datetime('now'), datetime('now'));
