# The employee portal

The portal is where someone joining the firm is onboarded, and where they stay
for the rest of their employment: their contract, the handbook, their own
records, and the client work assigned to them all live behind one sign-in.

- **[WORKFLOW.md](./WORKFLOW.md)** covers client deliverables and the review cycle.
- This document covers onboarding, documents and HR records.

---

## What a new joiner sees

A partner creates the account, fills in the employment record, and starts the
onboarding programme. The new joiner signs in with a temporary password and lands
on **My onboarding**, which shows:

1. **A progress bar** across three things: their own onboarding steps, the
   documents they owe a response to, and whether their personal details are
   complete.
2. **The welcome message from the Managing Director** - markdown, edited in
   Portal settings, signed with the MD's name and title.
3. **Documents to read and sign** - their contract first, then handbook policies.
4. **Their personal details** - with a direct list of what is still missing.
5. **Their own steps** - tickable.
6. **What the firm is doing for them** - the HR-side steps, visible but not
   tickable by them, so they can see the firm is doing its part.
7. **Their signed documents** - a permanent record they can return to.

Until they set their own password, the API confines them to the account screen
and their onboarding - a temporary password cannot be used to reach client work.

---

## Documents: contracts, policies, notices

One table backs all of them, distinguished by `kind` and by what response they
require.

| | Contract | Handbook policy |
| --- | --- | --- |
| `kind` | `contract` | `policy` |
| `audience` | `individual` - one named employee | `all` |
| Response | **Signature** | **Acknowledgement** |
| Where it appears | Onboarding, then their document list | The handbook |

**Lifecycle.** Draft → published → archived. Nothing is visible to staff, and
nothing can be signed, until a partner publishes it. The seeded handbook ships as
drafts deliberately: the policies need review against the law that applies to the
firm before anyone is asked to agree to them.

**Signing.** The employee reads the document, ticks an explicit attestation, and
types their full name. The system:

- requires the typed name to match the name on their account (case and internal
  spacing are forgiven; a different name is not);
- disables the control until they have scrolled to the end of the text;
- stores a **SHA-256 hash of the exact text** they agreed to, plus the timestamp,
  IP address and user agent;
- keys the record to the **document version**, and refuses a second response to
  the same version.

**Amendment is the interesting part.** Editing the text of a *published* document
raises its version. Because outstanding-document queries compare signatures
against the current version, the amended policy reappears in everyone's list and
must be acknowledged again - while the earlier signatures survive as a record of
what was agreed before, provable against the stored hash. Editing a draft changes
nothing, because nobody has agreed to it yet.

The seeded handbook covers: code of conduct and ethics, client confidentiality
and data protection, independence and conflicts of interest, anti-money
laundering, IT security and acceptable use, leave and absence, working hours and
remote work, equal opportunity and anti-harassment, performance and development,
grievance and disciplinary procedure - plus a contract of employment template to
copy per employee.

---

## HR records and who can see what

Employee data is split across three tables, because the three groups have
genuinely different audiences. Splitting them means a query that forgets a filter
cannot leak the most sensitive fields.

| Data | Table | Who can see it |
| --- | --- | --- |
| Job title, department, grade, start date, probation date, line manager | `employee_profiles` | Manager grade and above, plus the employee |
| Date of birth, home address, phone, emergency contact, next of kin | `employee_profiles` (personal columns) | **The employee and HR administrators only** |
| Salary, bank details, tax and social security numbers | `employee_compensation` | **Partner grade only**, plus the employee's own |

A line manager deliberately does **not** get their reports' home addresses or
dates of birth. They have no working need for them.

**Who maintains what.** The employee maintains their own contact details,
emergency contact, next of kin and qualifications. They cannot change their own
job title, grade, start date or pay - those are HR-controlled, and the API
rejects the attempt rather than ignoring it.

**The HR trail** (`hr_events`) is append-only and records employment record
changes, document signatures, onboarding progress and pay amendments. Pay changes
are recorded as *having happened* without writing the values into the trail.

---

## The onboarding programme

Sixteen standard steps, created per employee, split between the new joiner and
HR. It is defined in [`shared/hr.ts`](../shared/hr.ts) as
`ONBOARDING_PROGRAMME`, so editing it there changes the programme for future
joiners; individual one-off steps can be added per person from the employee
record.

Employee-owned steps cover reading the welcome, completing their details,
supplying identification and certificates, signing the contract, acknowledging
the handbook and completing the independence declaration. HR-owned steps cover
issuing the contract, verifying identity and right to work, references, system
accounts, payroll registration, a buddy, induction, and setting probation
objectives.

Document signing is tracked through `documents` rather than duplicated as
checklist items, so ticking "sign your contract" and actually signing it cannot
disagree.

**Onboarding is surfaced, not enforced.** An employee with an unsigned contract
still gets to their work queue; the outstanding items sit prominently on their
portal and on the HR overview. Blocking work would punish the employee for a
delay that is often the firm's. If you want a hard block, the place to add it is
`requireUser` in `worker/auth.ts`, next to the temporary-password gate.

---

## Where things are

| Screen | Path | Who |
| --- | --- | --- |
| My onboarding | `/onboarding` | Everyone |
| Employee handbook | `/handbook` | Everyone |
| A document, with signing | `/documents/:id` | Whoever it is addressed to |
| My details | `/my-profile` | Everyone |
| People directory and onboarding progress | `/people` | Manager and above |
| Personnel file | `/people/:id` | Self, manager, HR - by section |
| Portal settings: handbook, welcome, logo, email | `/portal-admin` | Partner and above |
| Accounts and grades | `/team` | Partner and above |

---

## Before you use it for real

- **Have the handbook reviewed.** The seeded policies are drafting starting
  points, not finished legal instruments. Review each against the employment law
  and professional standards that apply to the firm, then publish. They ship as
  drafts so this cannot be skipped by accident.
- **Complete the contract template** per employee and issue it as an individually
  addressed document. Do not publish the template itself to staff.
- **Check whether typed-name signatures satisfy your jurisdiction** for
  employment contracts. The record captured here - attestation, matched name,
  timestamp, IP, and a hash of the exact text - is strong evidence of agreement,
  but whether it constitutes a valid signature is a legal question, not a
  technical one.
- **Certificates and identification are links**, not uploads. They point at your
  document store. Cloudflare R2 is the natural place to add real uploads.
- **Notifications are in-app only.** New joiners will not receive an email when a
  policy is published; they see it in their inbox on the portal.
