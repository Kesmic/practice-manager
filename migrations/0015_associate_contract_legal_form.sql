-- Rewrite the Associate Consultant Agreement as a legal instrument.
--
-- The version seeded by 0012 carried the right substance in the wrong register. It was
-- written in the same plain-English voice as the rest of this system, which is right for
-- a README and wrong for a document somebody signs: it explained the arrangement rather
-- than creating it. A contract has to do the second thing, and be recognisable as doing
-- it to the lawyer who reviews it and the court that might one day read it.
--
-- So this is the same bargain, redrafted: parties and recitals, an interpretation clause,
-- defined terms carried consistently through twenty-two numbered clauses, three schedules
-- and an execution block. Nothing about the commercial terms has changed - the tiered
-- fees, the onboarding attendance and travel subsidy, the reporting cadence, the restraint
-- periods and the conduct obligations are all as they were.
--
-- What has been added is what the earlier draft simply lacked as an instrument: warranties
-- and an indemnity against a reclassification claim, an intellectual property assignment
-- rather than an assertion of ownership, a data protection clause naming the controller
-- and processor roles, notice provisions, a survival clause, severance drawn so a
-- restraint read down by a court does not fall entirely, and a dispute resolution clause.
--
-- It remains a DRAFT and still says, in its own closing notes, that it has not been
-- reviewed by counsel and must be before anybody signs it. Naming the three clauses most
-- likely to be tested is more use to the firm than a general disclaimer.
--
-- Markdown, and still no tables: src/components/Markdown.tsx has no table support, so the
-- fee tiers and the service schedule are lists. Sub-clause numbers are written as
-- "**6.1**" at the start of a paragraph rather than as an ordered list, because a markdown
-- ordered list renumbers itself and would silently renumber the contract.
--
-- ## Why this updates the row rather than inserting a new one
--
-- 0012 has already been applied in production, so its INSERT cannot be edited. A second
-- template would leave the firm choosing between two documents of the same name, which is
-- how the wrong one gets issued.
--
-- The UPDATE is guarded on `updated_at = created_at`. 0012 set both with the same
-- datetime('now') call, and every write path through the API sets updated_at to an ISO
-- timestamp, so the two are equal only where nobody has touched the document since it was
-- seeded. If the firm has already begun editing their copy, this migration leaves it
-- entirely alone rather than discarding their work - which is the outcome that matters,
-- because the alternative is a silent overwrite of exactly the person who took the advice
-- to review it seriously.
UPDATE documents
   SET title      = 'Associate Consultant Agreement (template)',
       summary    = 'A contract for services for an independent Associate Consultant, in the form of a legal instrument. Complete every bracketed field, have it reviewed by counsel, then issue it to the Associate for signature.',
       body       = '# ASSOCIATE CONSULTANT AGREEMENT

**THIS AGREEMENT** is made on [DATE OF AGREEMENT]

**BETWEEN:**

**(1)  [FIRM LEGAL NAME]**, a company incorporated under the laws of the Republic of
Ghana with company number [FIRM COMPANY NUMBER] and having its registered office at
[FIRM REGISTERED ADDRESS] (the **"Firm"**); and

**(2)  [ASSOCIATE FULL NAME]**, an independent professional of [ASSOCIATE ADDRESS],
holding Taxpayer Identification Number [ASSOCIATE TIN] and Ghana Card number
[ASSOCIATE GHANA CARD NUMBER] (the **"Associate"**),

each a **"Party"** and together the **"Parties"**.

## BACKGROUND

**(A)**  The Firm provides an integrated accounting, payroll, tax and regulatory
compliance subscription service to its clients.

**(B)**  The Associate carries on an independent professional practice and holds
themselves out as competent to provide services of that description.

**(C)**  The Firm wishes to engage the Associate, and the Associate wishes to be engaged,
on a contract for services on the terms set out in this Agreement.

**NOW IT IS HEREBY AGREED** as follows:

## 1.  DEFINITIONS AND INTERPRETATION

**1.1**  In this Agreement, unless the context otherwise requires:

- **"Assigned Client"** means a client of the Firm which the Firm has allocated to the
  Associate under clause 8, as recorded in Schedule 3 and as amended from time to time in
  accordance with this Agreement.
- **"Commencement Date"** means [COMMENCEMENT DATE].
- **"Confidential Information"** has the meaning given in clause 12.1.
- **"Deliverables"** means the outputs described in Schedule 1 and any other output which
  the Parties agree in writing falls within the Services.
- **"Onboarding Period"** means, in relation to each newly signed Assigned Client, the
  period of [ONBOARDING MONTHS] months from the commencement date of that client''s
  subscription with the Firm.
- **"Service Fee"** means the fee payable in respect of an Assigned Client, calculated in
  accordance with clause 6 and Schedule 2.
- **"Services"** means the services described in Schedule 1.
- **"Team Lead"** means the person nominated by the Firm from time to time to perform the
  quality assurance functions described in clause 5, being at the date of this Agreement
  [TEAM LEAD NAME].
- **"Working Day"** means a day other than a Saturday, Sunday or public holiday in the
  Republic of Ghana.

**1.2**  Clause headings are for convenience only and shall not affect the construction of
this Agreement.

**1.3**  Words importing the singular include the plural and vice versa, and words
importing one gender include every gender.

**1.4**  A reference to a statute or statutory provision is a reference to it as amended,
extended or re-enacted from time to time, and includes all subordinate legislation made
under it.

**1.5**  Any phrase introduced by the words "including", "includes", "in particular" or
"for example", or any similar expression, shall be construed as illustrative and shall not
limit the sense of the words preceding those terms.

**1.6**  The Schedules form part of this Agreement and shall have effect as if set out in
full in the body of this Agreement. In the event of any conflict between the body of this
Agreement and a Schedule, the body of this Agreement shall prevail.

## 2.  STATUS OF THE PARTIES

**2.1**  This Agreement constitutes a contract for services and does not constitute a
contract of employment. The Associate is engaged as an independent contractor and not as
an employee, worker, agent or partner of the Firm.

**2.2**  For the avoidance of doubt, and without limiting clause 2.1:

- the Labour Act, 2003 (Act 651) and any protections, entitlements or remedies conferred
  by it upon employees, including in relation to notice, severance, redundancy, paid
  leave, hours of work and unfair termination, do not apply to this Agreement;
- the Firm shall not enrol the Associate in, or make contributions on the Associate''s
  behalf to, any scheme established under the National Pensions Act, 2008 (Act 766),
  whether Tier 1 or Tier 2;
- the Firm shall not operate pay-as-you-earn deductions in respect of any sum payable
  under this Agreement, save for withholding tax as provided in clause 6.6; and
- the Associate is not entitled to participate in any benefit, insurance, bonus or
  incentive arrangement operated by the Firm for its employees.

**2.3**  The Associate shall not at any time hold themselves out as an employee, officer
or agent of the Firm, nor purport to bind the Firm, save as expressly authorised in
writing by the Firm.

**2.4**  The Associate acknowledges that the consideration payable under this Agreement
has been calculated on the footing that the Associate bears their own tax, pension and
insurance costs, and that the Associate has taken, or has had the opportunity to take,
independent advice as to the effect of this Agreement.

**2.5**  Nothing in this Agreement shall create a partnership, joint venture or
relationship of employer and employee between the Parties.

## 3.  APPOINTMENT AND TERM

**3.1**  The Firm appoints the Associate, and the Associate accepts appointment, to
provide the Services in respect of each Assigned Client on and subject to the terms of
this Agreement.

**3.2**  This Agreement takes effect on the Commencement Date and shall continue until
terminated in accordance with clause 18.

**3.3**  This Agreement is non-exclusive. The Firm may engage other associates on the same
or different terms, and the Associate may provide services to third parties, subject
always to clauses 12, 14 and 15.

**3.4**  The Firm gives no undertaking as to the number of Assigned Clients that will be
allocated to the Associate, or that any will be allocated at all.

## 4.  THE SERVICES

**4.1**  The Associate shall provide the Services in respect of each Assigned Client with
all reasonable skill, care and diligence, and to the standard reasonably to be expected of
a competent professional experienced in providing services of a similar nature.

**4.2**  The Associate shall provide the Services in compliance with:

- all applicable laws of the Republic of Ghana, including the Income Tax Act, 2015 (Act
  896), the Value Added Tax Act, 2013 (Act 870), the Revenue Administration Act, 2016 (Act
  915), the Companies Act, 2019 (Act 992) and the National Pensions Act, 2008 (Act 766);
- the applicable financial reporting framework, including the IFRS for SMEs where
  relevant;
- the ethical requirements of any professional body of which the Associate is a member;
  and
- the Firm''s quality control procedures, methodologies and templates as notified to the
  Associate from time to time.

**4.3**  The Associate shall determine the manner in which, the hours during which and the
place at which the Services are performed, subject only to clauses 4.4, 9 and 10 and to
the Deliverables and deadlines applicable to each Assigned Client.

**4.4**  The Associate shall not subcontract, delegate or assign the performance of the
Services or any part of them without the prior written consent of the Firm.

**4.5**  The Associate shall provide, at their own cost, all equipment reasonably required
to perform the Services, including a computer, a mobile telephone and internet
connectivity, save for such software licences and client system access as the Firm
expressly provides.

## 5.  QUALITY ASSURANCE AND REPORTING

**5.1**  The Associate shall report on the Deliverables to the Team Lead. The function of
the Team Lead is the quality assurance of the Deliverables, and does not extend to the
supervision or direction of the Associate''s working hours, working methods or place of
work, which remain matters for the Associate.

**5.2**  The Associate shall submit to the Team Lead, in respect of each Assigned Client,
a written status report at intervals of not more than [STATUS REPORT INTERVAL], recording
the work completed, the deadlines falling due and any matter giving rise to risk.

**5.3**  At the end of each calendar month the Team Lead shall determine whether the
Deliverables in respect of each Assigned Client have been completed to the standard
required by clause 4.1. That determination is a condition precedent to payment under
clause 6.4.

**5.4**  The Associate shall notify the Team Lead in writing without delay upon becoming
aware of:

- any circumstance which may cause a statutory deadline of an Assigned Client to be
  missed;
- any complaint, expression of dissatisfaction or dispute raised by an Assigned Client;
- any matter which may give rise to a claim against the Firm or the Associate; and
- any suspected fraud, money laundering or other unlawful conduct.

## 6.  SERVICE FEES

**6.1**  In consideration of the proper performance of the Services, the Firm shall pay
the Associate a Service Fee in respect of each Assigned Client, calculated by reference to
that client''s subscription tier at the rates set out in Schedule 2.

**6.2**  The Service Fee is a fixed fee for the whole of the Deliverables in respect of an
Assigned Client for the month in question. It is not a salary and is not calculated by
reference to hours worked.

**6.3**  The Associate shall submit to the Firm a monthly invoice, itemising each Assigned
Client and the Service Fee claimed in respect of it, together with any sum claimed under
clause 7.

**6.4**  Subject to clause 5.3, the Firm shall pay each valid invoice within
[PAYMENT DAYS] Working Days of receipt, in arrears, by transfer to the bank account
notified in writing by the Associate.

**6.5**  Where an Assigned Client is allocated to or ceases to be allocated to the
Associate part-way through a month, the Service Fee for that client for that month shall
be apportioned on a daily basis.

**6.6**  The Firm shall deduct from each payment such withholding tax as it is obliged to
deduct under the Income Tax Act, 2015 (Act 896), and shall furnish the Associate with the
corresponding withholding tax credit certificate within a reasonable period.

**6.7**  Where the Deliverables in respect of an Assigned Client are materially incomplete
in any month for reasons attributable to the Associate, the Firm may withhold the Service
Fee for that client in whole or in part until the Deliverables are completed. The Firm
shall notify the Associate in writing of the sum withheld and the reason for it. No
deduction shall be made in respect of a delay attributable to the Firm or to the client.

**6.8**  The Firm may review the rates in Schedule 2 from time to time and shall do so at
least annually. Any revision shall be notified to the Associate in writing not less than
[FEE NOTICE DAYS] days before it takes effect, shall apply prospectively only, and shall
not affect any sum already accrued.

**6.9**  The Associate is solely responsible for the registration, computation, reporting
and payment of all taxes and social security contributions arising in respect of sums paid
under this Agreement, and shall indemnify the Firm in accordance with clause 17.2.

## 7.  ONBOARDING ATTENDANCE AND TRAVEL SUBSIDY

**7.1**  During the Onboarding Period in respect of each newly signed Assigned Client, the
Associate shall attend that client''s premises in person not fewer than [ONBOARDING VISITS]
times in each week, for the purposes of collecting and reconciling records, configuring
systems, establishing processes and resolving matters arising on onboarding.

**7.2**  Subject to clause 7.3, the Firm shall pay the Associate a travel subsidy of
GHS [TRAVEL SUBSIDY] per month in respect of each Assigned Client for the duration of that
client''s Onboarding Period, payable together with the Service Fee for that client.

**7.3**  The travel subsidy is payable only in respect of a month in which the attendance
required by clause 7.1 has been met and evidenced in the status reports submitted under
clause 5.2.

**7.4**  After the expiry of the Onboarding Period, the frequency of attendance at an
Assigned Client''s premises shall be such as the Associate reasonably considers necessary
for the proper performance of the Services, in consultation with the Team Lead.

## 8.  ALLOCATION OF CLIENTS

**8.1**  The allocation and reallocation of clients among associates is at the sole
discretion of the Firm, having regard to capacity, competence, client preference and the
requirements of the Firm''s business.

**8.2**  The Associate may decline the allocation of a further client where acceptance
would, in the Associate''s reasonable professional judgement, prejudice the proper
performance of the Services in respect of an existing Assigned Client. A refusal on that
ground shall not constitute a breach of this Agreement.

**8.3**  Where an Assigned Client changes subscription tier, the Service Fee in respect of
that client shall be adjusted to the rate applicable to the new tier with effect from the
date of the change.

**8.4**  Where an Assigned Client terminates its subscription, the Service Fee in respect
of that client shall cease with effect from the date of termination, apportioned in
accordance with clause 6.5.

**8.5**  Where an Assigned Client is reallocated away from the Associate, the Associate
shall, within [HANDOVER DAYS] Working Days, deliver up to the Firm all working papers,
records, credentials and other materials relating to that client, and shall be paid the
Service Fee apportioned to the date of completion of that handover.

## 9.  AVAILABILITY

**9.1**  The Associate shall be reasonably contactable between the hours of 9.00 a.m. and
5.00 p.m. on each Working Day for the purposes of responding to Assigned Clients and
liaising with the Team Lead.

**9.2**  The Associate shall attend such review meetings, training sessions and briefings
as the Firm may reasonably require, which may be conducted remotely.

**9.3**  Clauses 9.1 and 9.2 are requirements as to availability and co-ordination only,
and do not constitute the direction or control of the Associate''s working time for any
purpose.

## 10.  STANDARDS OF PERFORMANCE

**10.1**  The Associate shall procure that, in respect of each Assigned Client:

- no statutory filing or payment deadline is missed, save where the delay is attributable
  to the client and has been escalated to the Team Lead in advance;
- monthly management accounts are delivered within [REPORTING DAYS] Working Days of the
  end of the month to which they relate;
- routine enquiries from the client are acknowledged within one Working Day;
- the Deliverables pass review by the Team Lead without material error; and
- complete and appropriately referenced working papers are maintained in the Firm''s
  document management system in respect of every Deliverable.

**10.2**  Where a Deliverable falls below the standard required by clause 4.1, the Team
Lead shall record the deficiency in writing and agree with the Associate a plan for its
rectification within a specified period. Rectification shall be at the Associate''s own
cost.

**10.3**  Persistent or material failure to meet the standards in clause 10.1, following
rectification under clause 10.2, entitles the Firm to reallocate Assigned Clients, to
suspend the allocation of further clients, or to terminate this Agreement under clause
18.3.

## 11.  PROFESSIONAL CONDUCT

**11.1**  The Associate shall at all times act with integrity, objectivity, professional
competence, due care and confidentiality in accordance with the ethical standards of the
accountancy profession.

**11.2**  The Associate shall not, in any circumstances, receive, hold or otherwise deal
with money belonging to an Assigned Client, or money due from an Assigned Client to any
revenue or regulatory authority, in any personal account or in any account other than one
designated by the Firm for that purpose.

**11.3**  The Associate shall not solicit or accept from any Assigned Client any payment,
gift, commission or benefit, other than customary hospitality of modest value, and shall
disclose any such hospitality to the Team Lead.

**11.4**  The Associate shall not make any representation or commitment as to the scope,
pricing or outcome of any engagement on behalf of the Firm without the Firm''s prior
written authorisation.

**11.5**  The Associate shall comply with the Anti-Money Laundering Act, 2020 (Act 1044)
and shall report to the Team Lead, without delay, any transaction or circumstance giving
rise to a suspicion of money laundering or other unlawful conduct.

## 12.  CONFIDENTIALITY

**12.1**  **"Confidential Information"** means all information of a confidential nature
disclosed to or acquired by the Associate in connection with this Agreement, whether
before or after its date and in whatever form, including information relating to the
affairs of any client of the Firm, and the Firm''s methodologies, templates, pricing,
systems, personnel and business plans.

**12.2**  The Associate shall keep all Confidential Information strictly confidential and
shall not disclose it to any person, or use it for any purpose other than the performance
of the Services.

**12.3**  Clause 12.2 does not apply to information which:

- is or becomes generally available to the public otherwise than through breach of this
  Agreement;
- was lawfully in the Associate''s possession, free of any duty of confidence, before
  disclosure by the Firm; or
- the Associate is required to disclose by law, by a court of competent jurisdiction or by
  a regulatory authority, provided that the Associate gives the Firm such notice as is
  lawfully permitted before making the disclosure.

**12.4**  The obligations in this clause survive termination of this Agreement without
limit of time in respect of client information, and for a period of
[BUSINESS CONFIDENTIALITY YEARS] years from termination in respect of the Firm''s own
business information.

## 13.  DATA PROTECTION

**13.1**  The Parties acknowledge that, in performing the Services, the Associate
processes personal data on behalf of the Firm and that the Firm is the data controller for
the purposes of the Data Protection Act, 2012 (Act 843).

**13.2**  The Associate shall:

- process personal data only on the documented instructions of the Firm and only to the
  extent necessary for the performance of the Services;
- process personal data only within systems approved by the Firm, and shall not store or
  transmit personal data on any personal, unapproved or unencrypted device or account;
- implement and maintain appropriate technical and organisational measures against
  unauthorised or unlawful processing and against accidental loss, destruction or damage;
- notify the Firm without undue delay, and in any event within [BREACH NOTICE HOURS]
  hours, upon becoming aware of any personal data breach; and
- on termination, at the Firm''s election, return or securely destroy all personal data in
  the Associate''s possession or control and certify that destruction in writing.

## 14.  RESTRICTIVE COVENANTS

**14.1**  The Associate shall not, during the term of this Agreement and for a period of
[NON-CIRCUMVENTION MONTHS] months after its termination, whether directly or indirectly
and whether on their own account or on behalf of any other person, provide or offer to
provide accounting, payroll, tax or regulatory services to any person who was an Assigned
Client, or to whom the Associate was introduced by the Firm, at any time during the
[LOOKBACK MONTHS] months preceding termination, otherwise than through the Firm.

**14.2**  The Associate shall not, during the term of this Agreement and for a period of
[NON-SOLICITATION MONTHS] months after its termination, solicit or endeavour to entice
away from the Firm any employee, associate, consultant or client of the Firm with whom the
Associate dealt during that period.

**14.3**  The Parties acknowledge that a breach of clause 14.1 would cause the Firm loss
which is difficult to quantify, and agree that the Firm shall be entitled to recover from
the Associate, as liquidated damages and as a genuine pre-estimate of that loss, a sum
equal to [LIQUIDATED DAMAGES MONTHS] months of the subscription fee payable by the client
concerned, without prejudice to any other remedy.

**14.4**  Each restriction in this clause 14 is separate and severable. If any restriction
is held to be void or unenforceable as drawn, but would be valid if its duration, extent
or scope were reduced, it shall apply with such modification as is necessary to make it
valid and enforceable.

**14.5**  The Associate acknowledges that the restrictions in this clause 14 are no wider
than is reasonably necessary for the protection of the Firm''s legitimate business
interests, and that the Associate has had the opportunity to take independent advice upon
them.

## 15.  CONFLICTS OF INTEREST

**15.1**  The Associate shall disclose to the Firm in writing, promptly upon becoming
aware of it, any actual or potential conflict of interest, including any personal, family
or financial connection with an Assigned Client and any engagement with a provider of
competing services.

**15.2**  The Firm may, following such disclosure, reallocate the Assigned Client
concerned or impose such other conditions as it reasonably considers necessary.

## 16.  INTELLECTUAL PROPERTY

**16.1**  All intellectual property rights in the templates, methodologies, systems,
checklists and other materials made available by the Firm to the Associate remain the
exclusive property of the Firm. The Associate is granted a non-exclusive, non-
transferable licence to use them solely for the performance of the Services, which
licence terminates automatically on termination of this Agreement.

**16.2**  All intellectual property rights in the Deliverables and in the working papers
produced by the Associate in the course of performing the Services shall vest in the Firm
absolutely upon creation. To the extent that any such right does not vest automatically,
the Associate hereby assigns it to the Firm with full title guarantee, and shall execute
such further documents as the Firm may reasonably require to give effect to this clause.

**16.3**  The Associate waives, to the fullest extent permitted by law, all moral rights
in the Deliverables and working papers.

## 17.  WARRANTIES AND INDEMNITIES

**17.1**  The Associate warrants that:

- they are entitled to provide the Services as an independent contractor and are not
  prevented from doing so by any other agreement or obligation;
- they hold the qualifications and experience represented to the Firm, and shall notify
  the Firm promptly if any professional membership relied upon lapses or is withdrawn; and
- they are registered with the Ghana Revenue Authority and shall remain so registered
  throughout the term.

**17.2**  The Associate shall indemnify the Firm against all liabilities, costs, expenses,
damages and losses suffered or incurred by the Firm arising out of or in connection with:

- any claim by any revenue or regulatory authority for income tax, social security
  contributions or similar liability in respect of sums paid to the Associate under this
  Agreement, together with any interest and penalties;
- any claim that the Associate is or was an employee of the Firm; and
- any wilful default, fraud or dishonesty of the Associate.

**17.3**  The Associate shall notify the Firm in writing, without delay, of any claim,
complaint or circumstance which may give rise to a liability of the Firm or of the
Associate in connection with the Services.

**17.4**  The Associate shall maintain such professional indemnity insurance as the Firm
may reasonably require and, on request, shall produce evidence of it.

## 18.  TERMINATION

**18.1**  Either Party may terminate this Agreement for convenience by giving the other
not less than [NOTICE DAYS] days'' written notice, in order to permit the orderly handover
of Assigned Clients.

**18.2**  Where no client has been allocated to the Associate for a continuous period of
[DORMANT DAYS] days, either Party may terminate this Agreement on seven days'' written
notice.

**18.3**  The Firm may terminate this Agreement with immediate effect by written notice if
the Associate:

- commits a material breach of this Agreement which is incapable of remedy, or which,
  being capable of remedy, is not remedied within [REMEDY DAYS] days of written notice
  requiring it to be remedied;
- commits any act of fraud or dishonesty, or is convicted of a criminal offence which in
  the reasonable opinion of the Firm affects their fitness to perform the Services;
- commits a breach of clause 11, 12, 13 or 14;
- fails, following rectification under clause 10.2, to meet the standards in clause 10.1;
  or
- conducts themselves in a manner which brings, or is likely to bring, the Firm or any of
  its clients into disrepute.

**18.4**  The Associate may terminate this Agreement with immediate effect by written
notice if the Firm fails to pay an undisputed invoice within [DEFAULT DAYS] days of the
date on which payment fell due, and fails to remedy that failure within a further
fourteen days of written notice.

## 19.  CONSEQUENCES OF TERMINATION

**19.1**  On termination of this Agreement for any reason, the Associate shall:

- complete the handover of every Assigned Client in accordance with clause 8.5;
- deliver up to the Firm all working papers, records, credentials, equipment and other
  materials belonging to the Firm or to any client of the Firm;
- irrecoverably delete any Confidential Information held electronically otherwise than in
  systems belonging to the Firm, and certify that deletion in writing if required; and
- relinquish all access to the Firm''s and any client''s systems.

**19.2**  The Firm shall pay the Associate all Service Fees and travel subsidies properly
accrued and unpaid to the effective date of termination, apportioned in accordance with
clause 6.5, subject to the completion of the obligations in clause 19.1 and to any sum
withheld under clause 6.7.

**19.3**  Termination shall not affect any right, remedy, obligation or liability of a
Party which has accrued as at the date of termination.

**19.4**  Clauses 1, 2, 12, 13, 14, 16, 17, 19, 20, 21 and 22 survive termination of this
Agreement.

## 20.  NOTICES

**20.1**  Any notice under this Agreement shall be in writing and shall be delivered by
hand, sent by prepaid registered post, or sent by electronic mail to the address of the
receiving Party set out at the head of this Agreement, or to such other address as that
Party may notify in writing.

**20.2**  A notice is deemed received: if delivered by hand, on delivery; if sent by
registered post, on the third Working Day after posting; and if sent by electronic mail,
at the time of transmission, provided that if transmission occurs outside business hours
it is deemed received when business hours next resume.

## 21.  GENERAL

**21.1  Entire agreement.**  This Agreement, together with its Schedules, constitutes the
entire agreement between the Parties and supersedes all previous agreements,
understandings and representations, whether written or oral, relating to its subject
matter. Each Party acknowledges that it has not relied upon any statement or
representation not set out in this Agreement, save that nothing in this clause limits any
liability for fraudulent misrepresentation.

**21.2  Variation.**  No variation of this Agreement is effective unless it is in writing
and signed by or on behalf of each Party.

**21.3  Waiver.**  No failure or delay by a Party in exercising any right or remedy shall
operate as a waiver of it, nor shall any single or partial exercise preclude any further
exercise of that or any other right or remedy.

**21.4  Severance.**  If any provision of this Agreement is or becomes invalid, illegal or
unenforceable, it shall be deemed modified to the minimum extent necessary to make it
valid, legal and enforceable. If such modification is not possible, the provision shall be
deemed deleted, and the deletion shall not affect the validity and enforceability of the
remainder of this Agreement.

**21.5  Assignment.**  The Associate shall not assign, transfer or otherwise dispose of
any of their rights or obligations under this Agreement. The Firm may assign this
Agreement to any successor to its business.

**21.6  Third parties.**  A person who is not a Party to this Agreement has no right to
enforce any of its terms.

**21.7  Counterparts.**  This Agreement may be executed in any number of counterparts,
each of which when executed constitutes an original, and all of which together constitute
one and the same instrument.

## 22.  GOVERNING LAW AND DISPUTE RESOLUTION

**22.1**  This Agreement and any dispute or claim arising out of or in connection with it,
including any non-contractual dispute or claim, is governed by and shall be construed in
accordance with the laws of the Republic of Ghana.

**22.2**  The Parties shall first seek to resolve any dispute arising under this Agreement
by good faith negotiation between them, and failing resolution within [NEGOTIATION DAYS]
days, by mediation under the Alternative Dispute Resolution Act, 2010 (Act 798).

**22.3**  Subject to clause 22.2, the courts of the Republic of Ghana shall have exclusive
jurisdiction to settle any dispute or claim arising out of or in connection with this
Agreement.

---

## SCHEDULE 1 - THE SERVICES

In respect of each Assigned Client, the Associate shall provide the following services to
the extent that they fall within that client''s subscription scope.

### Part A - Accounting and bookkeeping

- Recording of transactions in the client''s cloud accounting system, being
  [ACCOUNTING PLATFORM] or such other system as the client uses.
- Reconciliation of bank and mobile money accounts.
- Management of accounts payable and accounts receivable.
- Preparation and delivery of monthly management accounts, comprising a statement of
  profit or loss, a statement of financial position and a statement of cash flows.
- Preparation of annual financial statements to a standard fit for review.

### Part B - Payroll

- Computation of monthly payroll, including gross to net computation, allowances and
  statutory and voluntary deductions.
- Computation and electronic filing of pay-as-you-earn returns with the Ghana Revenue
  Authority.
- Preparation of Tier 1 and Tier 2 pension schedules, the filing of those schedules and
  the co-ordination of payment.
- Issue of payslips and maintenance of payroll records.

### Part C - Tax compliance

- Computation and filing of monthly value added tax, National Health Insurance Levy,
  GETFund Levy and COVID-19 Health Recovery Levy returns, where applicable.
- Computation of withholding tax, the issue of withholding tax certificates and the filing
  of the related returns.
- Computation and filing of quarterly corporate income tax instalments and the annual
  return.
- Handling of routine correspondence with the Ghana Revenue Authority relating to the
  Assigned Client, escalating any contentious or complex matter to the Team Lead.

### Part D - Regulatory compliance

- Maintenance and execution of the Assigned Client''s compliance calendar, including annual
  returns, beneficial ownership filings, business operating permit renewals, data
  protection registration renewals and any sector-specific filing.
- Escalation to the Team Lead of any regulatory risk or exposure to a missed deadline.

### Part E - Client liaison

- Acting as the Assigned Client''s principal point of contact for routine matters.
- Acknowledging routine enquiries within one Working Day.
- Attendance at the Assigned Client''s premises in accordance with clause 7.
- Maintenance of complete working papers in respect of every Deliverable.

---

## SCHEDULE 2 - SERVICE FEES

The Service Fee payable in respect of an Assigned Client, per calendar month, is
determined by that client''s subscription tier as follows.

- **Starter tier** - GHS [STARTER FEE]. Indicative client profile: one to five members of
  staff and a low volume of transactions.
- **Growth tier** - GHS [GROWTH FEE]. Indicative client profile: six to twenty-five
  members of staff and moderate complexity.
- **Enterprise tier** - GHS [ENTERPRISE FEE]. Indicative client profile: twenty-six or
  more members of staff, a high volume of transactions or multiple entities.

The travel subsidy payable under clause 7.2 is GHS [TRAVEL SUBSIDY] per month per Assigned
Client during that client''s Onboarding Period.

All sums stated in this Schedule are gross of the withholding tax to be deducted under
clause 6.6.

---

## SCHEDULE 3 - CLIENTS ASSIGNED AT THE COMMENCEMENT DATE

- [CLIENT NAME] - [TIER] tier - Onboarding Period [ENDS ON DATE / not applicable].
- [CLIENT NAME] - [TIER] tier - Onboarding Period [ENDS ON DATE / not applicable].

Clients may be allocated to and reallocated away from the Associate in accordance with
clause 8 without variation of this Agreement.

---

## EXECUTION

**IN WITNESS WHEREOF** the Parties have entered into this Agreement on the date first
written above.

**SIGNED for and on behalf of [FIRM LEGAL NAME]**

Name: [SIGNATORY NAME]

Position: [SIGNATORY POSITION]

Date: [DATE]

**SIGNED by the ASSOCIATE**

By signing this Agreement on the portal, the Associate confirms that they have read and
understood it, that they agree to be bound by it, and that the Taxpayer Identification
Number, Ghana Card number and address recorded at the head of this Agreement are correct.

The portal records the date and time of signature, the network address from which it was
made, and a cryptographic hash of the exact text agreed to.

---

## NOTES FOR THE PERSON COMPLETING THIS TEMPLATE

**Delete this section before issuing the Agreement.**

**Have it reviewed by a qualified lawyer before anyone signs it.** This is a drafting
starting point produced with the portal, not a settled instrument, and it has not been
reviewed by counsel. The clauses most likely to be tested are the independent contractor
characterisation in clause 2, the liquidated damages provision in clause 14.3 and the
restraint periods in clauses 14.1 and 14.2. A Ghanaian court will look at the substance of
the relationship rather than its label, and will read down a restraint drawn more widely
than is necessary to protect a legitimate interest. Clause 14.3 will be unenforceable as a
penalty if the sum is not a genuine pre-estimate of loss.

**Complete every bracketed field.** An unreplaced field is not a gap the reader will fill
in charitably.

**The portal''s onboarding programme assumes an employee, and this Agreement says the
Associate is not one.** The standard checklist asks a new joiner to sign a contract of
employment, to acknowledge the Employee Handbook policy by policy, to register for payroll
and statutory deductions, and to have probation objectives set. Every one of those,
applied to an independent contractor, is a fact that would be weighed against the Firm if
the characterisation in clause 2 were ever challenged. Before putting an Associate through
onboarding:

- remove or replace those steps on their checklist;
- set their employment type to **Consultant** on their HR record;
- leave the salary and bank fields on the compensation record empty, since the Associate
  is paid against an invoice rather than through payroll; and
- do not ask them to acknowledge the Employee Handbook. Where the Firm needs an Associate
  bound by a standard, bind them through this Agreement - clause 11 already carries the
  conduct obligations.

**Consider whether the Associate should carry their own professional indemnity cover.**
Clause 17.4 provides for it but leaves the requirement to the Firm.',
       updated_at = created_at
 WHERE id = 'tpl_associate_contract'
   AND status = 'draft'
   AND updated_at = created_at;
