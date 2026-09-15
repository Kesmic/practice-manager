/**
 * Completing a contract from what the firm already knows about a person.
 *
 * Both contract templates are written with bracketed placeholders - `[JOB TITLE]`,
 * `[ASSOCIATE TIN]`, `[NOTICE DAYS]` - and until now somebody had to find and replace
 * every one of them by hand after copying the template. Thirty-eight of them, in a
 * fifteen-page instrument, per person. What actually happens when a document is issued
 * that way is that two or three are missed, and the employee signs a contract that says
 * their notice period is `[NOTICE DAYS]` days.
 *
 * The registry below says, for every placeholder in both templates, where its value is
 * supposed to come from. Three answers, and the distinction is the whole point:
 *
 * **`record`** - it is already in the person's record, so nobody should type it again.
 *   Their name, job title, start date, salary, address, TIN. Typing it a second time
 *   into a contract form is how a contract comes to disagree with the personnel file.
 *
 * **`firm`** - it is the same for everybody, so it is set once. The firm's legal name
 *   and company number, the notice period, the payment terms, the fee for each tier.
 *   Asking an administrator to retype twenty-five standard terms per person guarantees
 *   that the twenty-sixth Associate gets different ones.
 *
 * **`person`** - it genuinely differs per person and has no home in the record, so the
 *   administrator supplies it when the account is created.
 *
 * The distinction that matters most to a new joiner is inside `record`: some of those
 * columns are filled by the administrator when they create the account, and some by the
 * person themselves at first sign-in - their address, their TIN, their Ghana Card
 * number. An administrator who has those to hand can type them in at creation; one who
 * does not leaves them blank, and the first sign-in asks for them. Either way the
 * contract completes from the same column, so it cannot matter afterwards which of the
 * two supplied it.
 */

import type { EmploymentType } from "./hr";
import { isEngagedNotEmployed } from "./onboarding";

// ---------------------------------------------------------------------------
// Which template
// ---------------------------------------------------------------------------

export const CONTRACT_TEMPLATES = ["employment", "associate"] as const;
export type ContractTemplate = (typeof CONTRACT_TEMPLATES)[number];

/** Which of the two templates an employment type is issued. */
export function templateFor(type: EmploymentType): ContractTemplate {
  return isEngagedNotEmployed(type) ? "associate" : "employment";
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type FieldSupplier = "record" | "firm" | "person";

/** Where a `record` field is read from, and who is expected to fill it. */
export interface RecordSource {
  table: "user" | "profile" | "compensation" | "settings";
  column: string;
  /**
   * Who supplies it. `admin` means the administrator fills it when they set the
   * person up; `employee` means it is one of the things asked at first sign-in, and
   * so may legitimately be blank until the person has signed in for the first time.
   */
  filledBy: "admin" | "employee";
}

export interface ContractField {
  /** The placeholder text, without its brackets. */
  token: string;
  label: string;
  hint?: string;
  group: string;
  supplier: FieldSupplier;
  templates: ContractTemplate[];
  input: "text" | "textarea" | "date" | "number";
  /** Only on `record` fields. */
  from?: RecordSource;
  /** Only on `firm` fields: what a new deployment starts with. */
  fallback?: string;
  /** Shown beside a number, so "30" reads as "30 days". */
  suffix?: string;
}

const BOTH: ContractTemplate[] = ["employment", "associate"];
const EMPLOYMENT: ContractTemplate[] = ["employment"];
const ASSOCIATE: ContractTemplate[] = ["associate"];

export const CONTRACT_FIELDS: ContractField[] = [
  // ------------------------------------------------------------------ the firm
  {
    token: "FIRM NAME",
    label: "Firm name",
    group: "The firm",
    supplier: "record",
    templates: EMPLOYMENT,
    input: "text",
    from: { table: "settings", column: "firm_name", filledBy: "admin" },
  },
  {
    token: "FIRM LEGAL NAME",
    label: "Registered company name",
    hint: "As it appears on the certificate of incorporation, not the trading name.",
    group: "The firm",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "text",
  },
  {
    token: "FIRM COMPANY NUMBER",
    label: "Company registration number",
    group: "The firm",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "text",
  },
  {
    token: "FIRM REGISTERED ADDRESS",
    label: "Registered office address",
    group: "The firm",
    supplier: "firm",
    templates: BOTH,
    input: "textarea",
  },
  {
    token: "SIGNATORY NAME",
    label: "Who signs for the firm",
    group: "The firm",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "text",
  },
  {
    token: "SIGNATORY POSITION",
    label: "Their position",
    group: "The firm",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "text",
    fallback: "Managing Director",
  },
  {
    token: "ACCOUNTING PLATFORM",
    label: "Cloud accounting system",
    hint: "Named in Schedule 1 as the system transactions are recorded in.",
    group: "The firm",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "text",
  },

  // ------------------------------------------------------------- who they are
  {
    token: "EMPLOYEE FULL NAME",
    label: "Full name",
    group: "Who they are",
    supplier: "record",
    templates: EMPLOYMENT,
    input: "text",
    from: { table: "user", column: "full_name", filledBy: "admin" },
  },
  {
    token: "ASSOCIATE FULL NAME",
    label: "Full name",
    group: "Who they are",
    supplier: "record",
    templates: ASSOCIATE,
    input: "text",
    from: { table: "user", column: "full_name", filledBy: "admin" },
  },
  {
    token: "ASSOCIATE ADDRESS",
    label: "Residential address",
    hint: "Asked at their first sign-in if you do not have it.",
    group: "Who they are",
    supplier: "record",
    templates: ASSOCIATE,
    input: "textarea",
    from: { table: "profile", column: "residential_address", filledBy: "employee" },
  },
  {
    token: "ASSOCIATE TIN",
    label: "Taxpayer Identification Number",
    hint: "Asked at their first sign-in if you do not have it.",
    group: "Who they are",
    supplier: "record",
    templates: ASSOCIATE,
    input: "text",
    from: { table: "profile", column: "tin", filledBy: "employee" },
  },
  {
    token: "ASSOCIATE GHANA CARD NUMBER",
    label: "Ghana Card number",
    hint: "Asked at their first sign-in if you do not have it.",
    group: "Who they are",
    supplier: "record",
    templates: ASSOCIATE,
    input: "text",
    from: { table: "profile", column: "id_number", filledBy: "employee" },
  },

  // ------------------------------------------------------------- the position
  {
    token: "JOB TITLE",
    label: "Job title",
    group: "The position",
    supplier: "record",
    templates: EMPLOYMENT,
    input: "text",
    from: { table: "profile", column: "job_title", filledBy: "admin" },
  },
  {
    token: "DEPARTMENT",
    label: "Department",
    group: "The position",
    supplier: "record",
    templates: EMPLOYMENT,
    input: "text",
    from: { table: "profile", column: "department", filledBy: "admin" },
  },
  {
    token: "LINE MANAGER",
    label: "Reports to",
    group: "The position",
    supplier: "record",
    templates: EMPLOYMENT,
    input: "text",
    from: { table: "profile", column: "line_manager_name", filledBy: "admin" },
  },
  {
    token: "LOCATION",
    label: "Normal place of work",
    group: "The position",
    supplier: "record",
    templates: EMPLOYMENT,
    input: "text",
    from: { table: "profile", column: "work_location", filledBy: "admin" },
  },
  {
    token: "TEAM LEAD NAME",
    label: "Team Lead",
    hint: "Who performs the quality assurance functions in clause 5.",
    group: "The position",
    supplier: "person",
    templates: ASSOCIATE,
    input: "text",
  },

  // ----------------------------------------------------------------- the dates
  {
    token: "START DATE",
    label: "Start date",
    group: "Dates",
    supplier: "record",
    templates: EMPLOYMENT,
    input: "date",
    from: { table: "profile", column: "start_date", filledBy: "admin" },
  },
  {
    token: "COMMENCEMENT DATE",
    label: "Commencement date",
    group: "Dates",
    supplier: "record",
    templates: ASSOCIATE,
    input: "date",
    from: { table: "profile", column: "start_date", filledBy: "admin" },
  },
  {
    token: "DATE OF AGREEMENT",
    label: "Date of the agreement",
    hint: "The date it is made, which is usually the date it is issued for signature.",
    group: "Dates",
    supplier: "person",
    templates: ASSOCIATE,
    input: "date",
  },

  // -------------------------------------------------------------- what they get
  {
    token: "CURRENCY",
    label: "Currency",
    group: "Pay",
    supplier: "record",
    templates: EMPLOYMENT,
    input: "text",
    from: { table: "compensation", column: "currency", filledBy: "admin" },
  },
  {
    token: "AMOUNT",
    label: "Gross annual salary",
    group: "Pay",
    supplier: "record",
    templates: EMPLOYMENT,
    input: "number",
    from: { table: "compensation", column: "annual_salary", filledBy: "admin" },
  },
  {
    token: "FREQUENCY",
    label: "Paid",
    group: "Pay",
    supplier: "record",
    templates: EMPLOYMENT,
    input: "text",
    from: { table: "compensation", column: "pay_frequency", filledBy: "admin" },
  },
  {
    token: "STARTER FEE",
    label: "Starter tier fee",
    hint: "Per assigned client, per calendar month, in GHS.",
    group: "Pay",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
  },
  {
    token: "GROWTH FEE",
    label: "Growth tier fee",
    group: "Pay",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
  },
  {
    token: "ENTERPRISE FEE",
    label: "Enterprise tier fee",
    group: "Pay",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
  },
  {
    token: "TRAVEL SUBSIDY",
    label: "Monthly travel subsidy",
    hint: "Per assigned client, in GHS, during the onboarding period.",
    group: "Pay",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
  },

  // ------------------------------------------------------- employment terms
  {
    token: "PROBATION MONTHS",
    label: "Probationary period",
    group: "Terms",
    supplier: "firm",
    templates: EMPLOYMENT,
    input: "number",
    suffix: "months",
    fallback: "6",
  },
  {
    token: "PROBATION NOTICE",
    label: "Notice during probation",
    group: "Terms",
    supplier: "firm",
    templates: EMPLOYMENT,
    input: "text",
    fallback: "one week's",
  },
  {
    token: "NOTICE PERIOD",
    label: "Notice after probation",
    group: "Terms",
    supplier: "firm",
    templates: EMPLOYMENT,
    input: "text",
    fallback: "one month's",
  },
  {
    token: "HOURS",
    label: "Normal weekly hours",
    group: "Terms",
    supplier: "firm",
    templates: EMPLOYMENT,
    input: "number",
    suffix: "hours",
    fallback: "40",
  },
  {
    token: "WORKING DAYS",
    label: "Working days",
    group: "Terms",
    supplier: "firm",
    templates: EMPLOYMENT,
    input: "text",
    fallback: "Monday to Friday",
  },
  {
    token: "LEAVE DAYS",
    label: "Annual leave",
    group: "Terms",
    supplier: "firm",
    templates: EMPLOYMENT,
    input: "number",
    suffix: "working days",
    fallback: "15",
  },

  // -------------------------------------------------------- agreement terms
  {
    token: "STATUS REPORT INTERVAL",
    label: "Status report interval",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "text",
    fallback: "one month",
  },
  {
    token: "REPORTING DAYS",
    label: "Management accounts delivered within",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "working days",
    fallback: "10",
  },
  {
    token: "PAYMENT DAYS",
    label: "Invoices paid within",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "working days",
    fallback: "15",
  },
  {
    token: "FEE NOTICE DAYS",
    label: "Notice of a fee revision",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "days",
    fallback: "30",
  },
  {
    token: "ONBOARDING MONTHS",
    label: "Onboarding period",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "months",
    fallback: "3",
  },
  {
    token: "ONBOARDING VISITS",
    label: "Client visits per week while onboarding",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "times",
    fallback: "2",
  },
  {
    token: "HANDOVER DAYS",
    label: "Handover on reallocation",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "working days",
    fallback: "5",
  },
  {
    token: "NOTICE DAYS",
    label: "Termination for convenience",
    group: "Terms",
    supplier: "firm",
    templates: BOTH,
    input: "number",
    suffix: "days",
    fallback: "30",
  },
  {
    token: "DORMANT DAYS",
    label: "Dormancy before either party may terminate",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "days",
    fallback: "90",
  },
  {
    token: "REMEDY DAYS",
    label: "Time to remedy a breach",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "days",
    fallback: "14",
  },
  {
    token: "DEFAULT DAYS",
    label: "Payment default before the Associate may terminate",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "days",
    fallback: "30",
  },
  {
    token: "NEGOTIATION DAYS",
    label: "Negotiation before mediation",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "days",
    fallback: "30",
  },
  {
    token: "BREACH NOTICE HOURS",
    label: "Notice of a personal data breach",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "hours",
    fallback: "24",
  },
  {
    token: "BUSINESS CONFIDENTIALITY YEARS",
    label: "Confidentiality in the firm's own business",
    hint: "Client information is protected without limit of time regardless.",
    group: "Terms",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "years",
    fallback: "3",
  },
  {
    token: "NON-CIRCUMVENTION MONTHS",
    label: "Non-circumvention",
    group: "Restrictive covenants",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "months",
    fallback: "12",
  },
  {
    token: "LOOKBACK MONTHS",
    label: "Look-back before termination",
    group: "Restrictive covenants",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "months",
    fallback: "12",
  },
  {
    token: "NON-SOLICITATION MONTHS",
    label: "Non-solicitation",
    group: "Restrictive covenants",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "months",
    fallback: "12",
  },
  {
    token: "LIQUIDATED DAMAGES MONTHS",
    label: "Liquidated damages",
    hint: "A genuine pre-estimate of loss, expressed as months of the client's fee.",
    group: "Restrictive covenants",
    supplier: "firm",
    templates: ASSOCIATE,
    input: "number",
    suffix: "months",
    fallback: "6",
  },
];

// ---------------------------------------------------------------------------
// Placeholders that are deliberately left alone
// ---------------------------------------------------------------------------

/**
 * Placeholders no merge field will ever fill, and why.
 *
 * Schedule 3 lists the clients assigned at the commencement date - a repeating block of
 * client, tier and onboarding period, of unknown length. Substituting one client name
 * into it would produce a schedule that looks complete and lists one client.
 *
 * The date beside each signature is filled when the document is signed, not when it is
 * issued. Substituting today's date would date the signature before it happened.
 */
export const MANUAL_TOKENS = new Set([
  "CLIENT NAME",
  "TIER",
  "DATE",
]);

// ---------------------------------------------------------------------------
// Reading the templates
// ---------------------------------------------------------------------------

/**
 * Every placeholder in a piece of text, in the order it first appears.
 *
 * Deliberately narrow: upper case, and no line breaks inside. Markdown link syntax
 * (`[label](url)`) and ordinary square brackets in prose are not placeholders, and a
 * pattern loose enough to catch them would mangle any document that used them.
 */
const TOKEN_PATTERN = /\[([A-Z][A-Z0-9 /'’.,-]*)\]/g;

export function tokensIn(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    seen.add(match[1]);
  }
  return [...seen];
}

const BY_TOKEN = new Map(CONTRACT_FIELDS.map((f) => [f.token, f]));

export function fieldFor(token: string): ContractField | undefined {
  return BY_TOKEN.get(token);
}

/** The fields one template uses, in the order the form should show them. */
export function fieldsFor(template: ContractTemplate): ContractField[] {
  return CONTRACT_FIELDS.filter((f) => f.templates.includes(template));
}

/** The fields one template uses, grouped under their headings. */
export function groupedFields(
  template: ContractTemplate,
): Array<{ group: string; fields: ContractField[] }> {
  const groups: Array<{ group: string; fields: ContractField[] }> = [];
  for (const field of fieldsFor(template)) {
    const last = groups.find((g) => g.group === field.group);
    if (last) last.fields.push(field);
    else groups.push({ group: field.group, fields: [field] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Filling one in
// ---------------------------------------------------------------------------

export interface FillResult {
  text: string;
  /** Tokens that had a value and were replaced. */
  filled: string[];
  /**
   * Tokens still in the text that a merge field was supposed to fill. These are the
   * ones worth telling somebody about.
   */
  outstanding: string[];
  /** Tokens still in the text that nothing was ever going to fill. */
  manual: string[];
}

/**
 * Substitutes what is known and reports honestly on what is not.
 *
 * A blank value is treated as no value. Replacing `[ASSOCIATE TIN]` with an empty
 * string would produce a sentence reading "holding Taxpayer Identification Number and
 * Ghana Card number ..." - grammatical, unremarkable to skim, and wrong. Leaving the
 * bracket in place is ugly, which is the point: it is the only version of this that
 * somebody notices before the document is issued.
 */
export function fillContract(
  text: string,
  values: Record<string, string | null | undefined>,
): FillResult {
  const filled: string[] = [];

  const out = text.replace(TOKEN_PATTERN, (whole, token: string) => {
    const value = values[token];
    if (value === undefined || value === null || String(value).trim() === "") {
      return whole;
    }
    if (!filled.includes(token)) filled.push(token);
    return String(value).trim();
  });

  const left = tokensIn(out);
  return {
    text: out,
    filled,
    outstanding: left.filter((t) => BY_TOKEN.has(t) && !MANUAL_TOKENS.has(t)),
    manual: left.filter((t) => !BY_TOKEN.has(t) || MANUAL_TOKENS.has(t)),
  };
}
