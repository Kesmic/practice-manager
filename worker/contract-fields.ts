/**
 * Resolving a contract's placeholders for one person.
 *
 * The registry in shared/contract-fields.ts says where each placeholder's value is
 * supposed to come from. This is the half that goes and gets it.
 *
 * Three sources, consulted in this order:
 *
 * 1. **A value stored against the person** (`contract_details`). First because it is the
 *    only one that can express "this Associate's terms were negotiated" - a per-person
 *    row overrides the firm-wide default for the same placeholder.
 * 2. **Their record** - the user row, the employment record, the compensation row,
 *    firm-wide settings. Read rather than copied, so a contract and a personnel file
 *    cannot come to disagree about a job title.
 * 3. **The firm-wide standard terms**, and failing that the starting value the registry
 *    carries for terms that have a conventional one.
 *
 * Anything still without a value is reported as outstanding rather than substituted
 * with a blank. A contract reading "notice of  days" is worse than one reading "notice
 * of [NOTICE DAYS] days", because only the second is noticed before it is issued.
 */

import type { Env } from "./env";
import {
  CONTRACT_FIELDS,
  type ContractField,
  type ContractTemplate,
  fieldsFor,
  templateFor,
} from "../shared/contract-fields";
import { EMPLOYMENT_TYPES, type EmploymentType } from "../shared/hr";
import { nowIso } from "./db";

// ---------------------------------------------------------------------------
// The firm's standard terms
// ---------------------------------------------------------------------------

/**
 * Held in `settings` as one JSON object rather than a row per placeholder, for the same
 * reason the visibility map and the intake service list are: it is edited as a whole by
 * one screen, and a half-written set of contract terms is not a state worth being able
 * to reach.
 *
 * Malformed JSON reads as "nothing set" rather than throwing. The alternative is that a
 * bad value in one settings row stops every contract being issued, which is a much
 * worse failure than falling back to the registry's starting values.
 */
export async function readContractDefaults(env: Env): Promise<Record<string, string>> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("contract_defaults")
    .first<{ value: string }>();
  return parseDefaults(row?.value);
}

export function parseDefaults(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// One person's record
// ---------------------------------------------------------------------------

interface PersonRow extends Record<string, unknown> {
  full_name: string;
  employment_type: string | null;
}

/**
 * Everything a `record` field might read, in one query.
 *
 * The line manager is joined by name rather than stored: the contract names a person,
 * and the record holds an id, so the two have to be reconciled somewhere. Doing it here
 * means changing who somebody reports to changes what their next contract says.
 */
async function readPerson(env: Env, userId: string): Promise<PersonRow | null> {
  return await env.DB.prepare(
    `SELECT u.full_name,
            p.job_title, p.department, p.work_location, p.start_date,
            p.employment_type, p.residential_address, p.tin, p.id_number,
            m.full_name AS line_manager_name,
            c.currency, c.annual_salary, c.pay_frequency
       FROM users u
       LEFT JOIN employee_profiles p ON p.user_id = u.id
       LEFT JOIN users m ON m.id = p.line_manager_id
       LEFT JOIN employee_compensation c ON c.user_id = u.id
      WHERE u.id = ?`,
  )
    .bind(userId)
    .first<PersonRow>();
}

/** Per-person overrides and the values with no home in the record. */
async function readPersonDetails(
  env: Env,
  userId: string,
): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(
    `SELECT token, value FROM contract_details WHERE user_id = ?`,
  )
    .bind(userId)
    .all<{ token: string; value: string }>();
  const out: Record<string, string> = {};
  for (const row of results) out[row.token] = row.value;
  return out;
}

// ---------------------------------------------------------------------------
// Presentation of a number
// ---------------------------------------------------------------------------

/**
 * How a salary reads in a contract.
 *
 * The record holds 96000 as a number. Substituted raw it produces "GHS 96000 per
 * annum", which no contract has ever said. Grouping is applied here rather than at the
 * form, because the form's job is to hold the number the firm agreed and this one's is
 * to produce the sentence.
 */
function presentSalary(value: unknown): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const whole = Number.isInteger(n);
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** "monthly" reads correctly after "payable"; the record's other values do too. */
function presentText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * How a date reads in a contract.
 *
 * Everything in this system stores a date as an ISO string, which is right for a
 * database and wrong for an instrument: no contract has ever commenced on 2026-10-01.
 * Applied only where the value is going into the document, so the form that collects it
 * still gets the ISO string its date input needs.
 *
 * Anything that is not a plain ISO date is returned untouched. A firm that has typed
 * "the first Monday of October" into a date field has said something the document can
 * carry, and rewriting it would be worse than leaving it.
 */
export function presentDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name) return value;
  return `${Number(day)} ${name} ${year}`;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ValueOrigin = "person" | "record" | "firm" | "fallback";

export interface ResolvedField {
  field: ContractField;
  value: string | null;
  /** Where the value came from, so the screen can say so. */
  origin: ValueOrigin | null;
  /**
   * True where the field is one the person themselves supplies at first sign-in and has
   * not yet. The distinction matters: an outstanding field the administrator must chase
   * reads differently from one that will answer itself when the person signs in.
   */
  awaiting_employee: boolean;
}

export interface ContractResolution {
  template: ContractTemplate;
  employment_type: EmploymentType;
  fields: ResolvedField[];
  /** Token to value, for handing to fillContract. */
  values: Record<string, string>;
}

/** Reads the person's employment type, defaulting the way the rest of the portal does. */
function readEmploymentType(row: PersonRow | null): EmploymentType {
  const value = row?.employment_type;
  return EMPLOYMENT_TYPES.includes(value as EmploymentType)
    ? (value as EmploymentType)
    : "permanent";
}

export async function resolveContract(
  env: Env,
  userId: string,
): Promise<ContractResolution | null> {
  const person = await readPerson(env, userId);
  if (!person) return null;

  const [details, defaults] = await Promise.all([
    readPersonDetails(env, userId),
    readContractDefaults(env),
  ]);

  const employmentType = readEmploymentType(person);
  const template = templateFor(employmentType);

  const fields: ResolvedField[] = fieldsFor(template).map((field) => {
    const resolved = resolveOne(field, person, details, defaults);
    return {
      field,
      ...resolved,
      awaiting_employee:
        resolved.value === null && field.from?.filledBy === "employee",
    };
  });

  /*
   * The form and the document want the same value written two different ways. A date
   * input needs "2026-10-01"; a contract needs "1 October 2026". So `fields` carries
   * the value as stored, and `values` - which is what gets substituted into the
   * document - carries it as it should read.
   */
  const values: Record<string, string> = {};
  for (const entry of fields) {
    if (entry.value === null) continue;
    values[entry.field.token] =
      entry.field.input === "date" ? presentDate(entry.value) : entry.value;
  }

  return { template, employment_type: employmentType, fields, values };
}

function resolveOne(
  field: ContractField,
  person: PersonRow,
  details: Record<string, string>,
  defaults: Record<string, string>,
): { value: string | null; origin: ValueOrigin | null } {
  // A value stored against this person wins, so negotiated terms survive a change to
  // the firm's standard ones.
  const own = details[field.token];
  if (own !== undefined && own.trim() !== "") {
    return { value: own.trim(), origin: "person" };
  }

  if (field.supplier === "record" && field.from) {
    const fromRecord = readFromRecord(field, person);
    if (fromRecord !== null) return { value: fromRecord, origin: "record" };
    return { value: null, origin: null };
  }

  const firm = defaults[field.token];
  if (firm !== undefined && firm.trim() !== "") {
    return { value: firm.trim(), origin: "firm" };
  }

  if (field.fallback) return { value: field.fallback, origin: "fallback" };
  return { value: null, origin: null };
}

function readFromRecord(field: ContractField, person: PersonRow): string | null {
  const from = field.from!;

  // The firm's own name is the one `record` field that is not about the person.
  if (from.table === "settings") return null;

  if (from.column === "annual_salary") return presentSalary(person.annual_salary);
  return presentText(person[from.column]);
}

/**
 * The firm name comes from settings, which are already read on most of the paths that
 * need this, so it is applied on top rather than fetched again inside the resolver.
 */
export function withFirmName(
  resolution: ContractResolution,
  firmName: string,
): ContractResolution {
  if (!firmName.trim()) return resolution;
  const values = { ...resolution.values };
  const fields = resolution.fields.map((entry) => {
    if (entry.field.from?.table !== "settings") return entry;
    if (entry.value !== null) return entry;
    values[entry.field.token] = firmName.trim();
    return { ...entry, value: firmName.trim(), origin: "record" as const };
  });
  return { ...resolution, fields, values };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const BY_TOKEN = new Map(CONTRACT_FIELDS.map((f) => [f.token, f]));

/**
 * Which of the submitted values may be stored against a person.
 *
 * `record` fields are rejected rather than ignored. Accepting a job title here would
 * store a second copy of it, and the two would disagree the first time somebody was
 * promoted - so the caller is told to edit the employment record instead.
 */
export function assertStorableToken(token: string): ContractField {
  const field = BY_TOKEN.get(token);
  if (!field) throw new Error(`${token} is not a contract field.`);
  if (field.supplier === "record") {
    throw new Error(
      `${field.label} comes from the employment record. Change it there and the contract follows.`,
    );
  }
  return field;
}

export function writeDetailStatements(
  env: Env,
  userId: string,
  actorId: string,
  values: Record<string, string>,
) {
  const timestamp = nowIso();
  const statements = [];
  for (const [token, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (value === "") {
      // Cleared rather than stored blank, so the firm-wide default takes over again.
      statements.push(
        env.DB.prepare(
          `DELETE FROM contract_details WHERE user_id = ? AND token = ?`,
        ).bind(userId, token),
      );
      continue;
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO contract_details (user_id, token, value, supplied_by, supplied_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, token) DO UPDATE
           SET value = excluded.value,
               supplied_by = excluded.supplied_by,
               supplied_at = excluded.supplied_at`,
      ).bind(userId, token, value, actorId, timestamp),
    );
  }
  return statements;
}
