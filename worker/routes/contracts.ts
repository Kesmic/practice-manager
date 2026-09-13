/**
 * The details that complete a contract.
 *
 * A contract template is written with bracketed placeholders, and somebody has to
 * supply a value for each one before it can be issued. This file is where those values
 * are collected and where they are read back.
 *
 * Two screens use it, and the division between them is the point of the whole feature:
 *
 * **The firm's standard terms** are set once, in Portal settings. The registered company
 * name, the notice period, the payment days, the fee for each tier - the same in every
 * contract the firm issues. Asking an administrator to retype twenty-five of those per
 * person guarantees that the twenty-sixth Associate is engaged on different ones.
 *
 * **One person's details** are supplied when their account is created. Most of them are
 * read straight from the employment record rather than typed again here, and the ones
 * that are neither the firm's nor in the record - who their Team Lead is, the date of
 * the agreement - are stored against them.
 *
 * What an administrator does not have at that point, they leave blank. The three
 * placeholders that describe the person rather than the engagement - their address,
 * their TIN, their Ghana Card number - are among the things asked at first sign-in, so
 * a blank is not a gap that has to be chased: it fills itself the first time the person
 * signs in, and the contract reads from the same column either way.
 */

import type { Env } from "../env";
import { requireRole, requireUser } from "../auth";
import { hrEventStatement, nowIso } from "../db";
import { Router, badRequest, forbidden, json, notFound, readJson } from "../http";
import { MIN_HR_ADMIN_ROLE, canSeeCompensation } from "../../shared/hr";
import { CONTRACT_FIELDS } from "../../shared/contract-fields";
import {
  assertStorableToken,
  readContractDefaults,
  resolveContract,
  withFirmName,
  writeDetailStatements,
} from "../contract-fields";
import { ensureProfile } from "./employees";
import { readSettings } from "./settings";

/** Setting a firm-wide term changes every contract issued afterwards. Partner grade. */
const MIN_DEFAULTS_ROLE = "partner" as const;

/** Longest value any single placeholder may hold. Generous for an address. */
const MAX_VALUE = 500;

export function registerContractRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // The firm's standard terms
  // -------------------------------------------------------------------------

  /**
   * Readable at HR administrator grade because the person filling in one contract needs
   * to see what the standard terms already say, and writable only at Partner grade
   * because changing one of them changes every contract issued afterwards.
   */
  router.get("/api/contract-defaults", async ({ request, env }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    return json({
      values: await readContractDefaults(env),
      fields: CONTRACT_FIELDS.filter((f) => f.supplier === "firm"),
    });
  });

  router.put("/api/contract-defaults", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_DEFAULTS_ROLE);
    const body = await readJson<{ values?: unknown }>(request);
    if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) {
      throw badRequest("Send the terms as an object of placeholder to value.");
    }

    /*
     * Written as a whole rather than merged into what is already there. A screen that
     * edits every term at once and saves a subset would silently keep a term the person
     * had just cleared, and "I deleted it and it came back" is not a bug anybody
     * enjoys diagnosing.
     */
    const cleaned: Record<string, string> = {};
    for (const [token, raw] of Object.entries(body.values as Record<string, unknown>)) {
      const field = CONTRACT_FIELDS.find((f) => f.token === token);
      if (!field) throw badRequest(`${token} is not a contract term.`);
      if (field.supplier !== "firm") {
        throw badRequest(`${field.label} is not a firm-wide term.`);
      }
      if (raw === null || raw === undefined || String(raw).trim() === "") continue;
      const value = String(raw).trim();
      if (value.length > MAX_VALUE) {
        throw badRequest(`${field.label} is too long.`);
      }
      cleaned[token] = value;
    }

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at, updated_by)
         VALUES ('contract_defaults', ?, ?, ?)
         ON CONFLICT (key) DO UPDATE
           SET value = excluded.value,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`,
      ).bind(JSON.stringify(cleaned), timestamp, actor.id),
      hrEventStatement(env, {
        subjectId: null,
        actorId: actor.id,
        kind: "contract_terms:updated",
        detail: `${Object.keys(cleaned).length} standard terms set`,
      }),
    ]);

    return json({ values: cleaned });
  });

  // -------------------------------------------------------------------------
  // One person's details
  // -------------------------------------------------------------------------

  /**
   * What the person's contract would say today, placeholder by placeholder.
   *
   * Every field is returned, resolved or not, with where its value came from. A screen
   * that only listed the gaps would be unable to show an administrator that the job
   * title it is about to print is the one on the record.
   */
  router.get("/api/employees/:id/contract-details", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const resolution = await loadResolution(env, params.id);

    /*
     * Pay is Partner grade, here as everywhere else. An HR administrator sees that the
     * salary field is filled without being told what it is - which is what they
     * actually need to know before issuing the contract.
     */
    const hidePay = !canSeeCompensation(actor.role);
    const fields = resolution.fields.map((entry) => ({
      ...entry.field,
      value:
        hidePay && entry.field.from?.table === "compensation" && entry.value !== null
          ? null
          : entry.value,
      restricted:
        hidePay && entry.field.from?.table === "compensation" && entry.value !== null,
      origin: entry.origin,
      awaiting_employee: entry.awaiting_employee,
    }));

    return json({
      template: resolution.template,
      employment_type: resolution.employment_type,
      fields,
      outstanding: fields.filter((f) => f.value === null && !f.restricted).length,
      awaiting_employee: fields.filter((f) => f.awaiting_employee).length,
    });
  });

  /**
   * Saves what the administrator supplied.
   *
   * One call, one transaction, three destinations, because the form is one form. The
   * alternative - the screen calling the employment record endpoint, then the pay
   * endpoint, then this one - can half-succeed, and a contract half-filled from a form
   * that reported success is worse than one that failed outright.
   */
  router.put("/api/employees/:id/contract-details", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const exists = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!exists) throw notFound("That employee does not exist.");
    await ensureProfile(env, params.id);

    const body = await readJson<{ values?: unknown }>(request);
    if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) {
      throw badRequest("Send the details as an object of placeholder to value.");
    }
    const supplied = body.values as Record<string, unknown>;

    const details: Record<string, string> = {};
    const profile: Record<string, string | null> = {};
    const compensation: Record<string, string | null> = {};

    for (const [token, raw] of Object.entries(supplied)) {
      const field = CONTRACT_FIELDS.find((f) => f.token === token);
      if (!field) throw badRequest(`${token} is not a contract field.`);

      const value = raw === null || raw === undefined ? "" : String(raw).trim();
      if (value.length > MAX_VALUE) throw badRequest(`${field.label} is too long.`);

      if (field.supplier !== "record") {
        // Throws where the token is one the record owns, which cannot happen here but
        // is the check that keeps the two paths honest if a field is ever recategorised.
        assertStorableToken(token);
        details[token] = value;
        continue;
      }

      const from = field.from!;
      if (from.table === "user" || from.table === "settings") {
        // The account's own name, and the firm's. Changed where they are changed.
        throw badRequest(
          `${field.label} is not set here. Change it on the account itself.`,
        );
      }
      if (from.table === "compensation") {
        if (!canSeeCompensation(actor.role)) {
          throw forbidden("Pay details are restricted to Partner grade and above.");
        }
        compensation[from.column] = value === "" ? null : value;
        continue;
      }
      profile[from.column] = value === "" ? null : value;
    }

    const statements = writeDetailStatements(env, params.id, actor.id, details);

    if (Object.keys(profile).length) {
      const columns = Object.keys(profile);
      statements.push(
        env.DB.prepare(
          `UPDATE employee_profiles
              SET ${columns.map((c) => `${c} = ?`).join(", ")}, updated_at = ?
            WHERE user_id = ?`,
        ).bind(...columns.map((c) => profile[c]), nowIso(), params.id),
      );
    }

    if (Object.keys(compensation).length) {
      const columns = Object.keys(compensation);
      /*
       * The row may not exist yet, and D1 has no UPDATE ... OR INSERT. Inserting the
       * key first and updating second is two statements in one batch, which is one
       * transaction, so a person cannot end up with a compensation row and no values.
       */
      statements.push(
        env.DB.prepare(
          `INSERT INTO employee_compensation (user_id, updated_at, updated_by)
           VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING`,
        ).bind(params.id, nowIso(), actor.id),
        env.DB.prepare(
          `UPDATE employee_compensation
              SET ${columns.map((c) => `${c} = ?`).join(", ")},
                  updated_at = ?, updated_by = ?
            WHERE user_id = ?`,
        ).bind(
          ...columns.map((c) => coerceCompensation(c, compensation[c])),
          nowIso(),
          actor.id,
          params.id,
        ),
      );
    }

    if (!statements.length) throw badRequest("No details supplied.");

    statements.push(
      hrEventStatement(env, {
        subjectId: params.id,
        actorId: actor.id,
        kind: "contract_details:updated",
        // The values themselves are not written into the trail. Somebody's salary
        // should not be readable from an audit log that HR administrators can see.
        detail: `Supplied: ${Object.keys(supplied).join(", ")}`,
      }),
    );

    await env.DB.batch(statements);
    return json({ ok: true });
  });

  /**
   * The person's own view of what is still wanted from them.
   *
   * Reachable before the first run is finished, because that is exactly when it is
   * useful: the first-sign-in form asks for these, and this is what tells the screen
   * which of them the administrator has already supplied.
   */
  router.get("/api/me/contract-details", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const resolution = await loadResolution(env, actor.id);
    return json({
      template: resolution.template,
      // Only the fields the person themselves supplies, and only whether each is
      // answered. The firm's commercial terms are not the employee's business until
      // the contract is issued to them.
      awaiting: resolution.fields
        .filter((f) => f.field.from?.filledBy === "employee")
        .map((f) => ({ token: f.field.token, label: f.field.label, given: f.value !== null })),
    });
  });
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

async function loadResolution(env: Env, userId: string) {
  const resolution = await resolveContract(env, userId);
  if (!resolution) throw notFound("That employee does not exist.");
  const settings = await readSettings(env);
  return withFirmName(resolution, settings.firm_name);
}

/**
 * The compensation table stores a salary as a number and everything else as text, so
 * the one numeric column is converted here rather than relying on SQLite's willingness
 * to accept "96000" into a REAL column and quietly store the string in some builds.
 */
function coerceCompensation(column: string, value: string | null): string | number | null {
  if (value === null) return null;
  if (column !== "annual_salary") return value;
  const n = Number(value.replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
