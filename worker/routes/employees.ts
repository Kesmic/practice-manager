/**
 * Employee records, onboarding and the personnel file.
 *
 * Access is layered: employment facts are visible across management, personal
 * details only to the employee and HR administrators, and pay and bank details
 * only at partner grade. The layering is enforced by which columns each handler
 * selects, not by filtering after the fact.
 */

import type { Env } from "../env";
import { requireRole, requireUser, type AuthenticatedUser } from "../auth";
import {
  assertExists,
  buildUpdate,
  hrEventStatement,
  newId,
  nowIso,
  notificationStatement,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalNumber,
  optionalString,
  requireString,
} from "../db";
import { Router, badRequest, forbidden, json, notFound, readJson } from "../http";
import {
  contractTemplateFor,
  programmeFor,
  stageDueDate,
  stageProgress,
} from "../../shared/onboarding";
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  MIN_DIRECTORY_ROLE,
  MIN_HR_ADMIN_ROLE,
  EMPLOYMENT_TYPE_LABELS,
  type EmploymentType,
  PAY_FREQUENCIES,
  canSeeCompensation,
  canSeePersonalDetails,
  computeProgress,
  isHrAdmin,
  missingBankFields,
  missingProfileFields,
} from "../../shared/hr";
import { OUTSTANDING_DOCUMENTS_SQL } from "./documents";
import { readSettings, requireArea } from "./settings";
import { attachmentsFor } from "./staff-files";
import { isAttachment } from "../../shared/staff-files";
import { seesEmploymentDetail } from "../../shared/directory";

/** Employment columns - safe for anyone with directory access. */
const EMPLOYMENT_COLUMNS = `p.user_id, p.staff_no, p.job_title, p.department,
  p.employment_type, p.employment_status, p.start_date, p.probation_end_date,
  p.confirmed_on, p.exit_date, p.line_manager_id, p.work_location,
  p.profile_completed_at, p.created_at, p.updated_at`;

/** Personal columns - the employee themselves, or an HR administrator. */
const PERSONAL_COLUMNS = `p.date_of_birth, p.gender, p.marital_status,
  p.personal_email, p.phone, p.residential_address, p.emergency_contact_name,
  p.emergency_contact_phone, p.emergency_contact_relationship,
  p.next_of_kin_name, p.next_of_kin_phone, p.highest_qualification,
  p.professional_body, p.membership_number,
  p.id_type, p.id_number, p.tin, p.id_document_url, p.right_to_work_note,
  p.qualification_document_url`;

/**
 * The columns `PATCH /api/me/profile` will write.
 *
 * Exported so the first-run invariant can be tested: every field the first sign-in
 * requires must be one this endpoint actually writes. A required field missing from
 * this list is not a validation error - the write silently drops it, the person fills
 * the form, presses save, and is held on it for ever with nothing on screen to explain
 * why. `tests/first-run.test.ts` pins it.
 */
export const PERSONAL_FIELDS = [
  "date_of_birth",
  "gender",
  "marital_status",
  "personal_email",
  "phone",
  "residential_address",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
  "next_of_kin_name",
  "next_of_kin_phone",
  "highest_qualification",
  "professional_body",
  "membership_number",
  "id_type",
  "id_number",
  "tin",
  "id_document_url",
  "right_to_work_note",
  "qualification_document_url",
] as const;

export function registerEmployeeRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // Self-service
  // -------------------------------------------------------------------------

  /** The signed-in employee's own record. Always available to them. */
  router.get("/api/me/profile", async ({ request, env }) => {
    // Reachable on a temporary password so a new joiner can get started.
    const actor = await requireUser(env, request, { allowPasswordPending: true, allowProfilePending: true });
    return json(await ownProfilePayload(env, actor));
  });

  /**
   * Self-service update of personal details. An employee may maintain their own
   * contact and next-of-kin information but not their own job title, grade,
   * start date or pay - those are HR-controlled.
   */
  router.patch("/api/me/profile", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    await ensureProfile(env, actor.id);

    const body = await readJson<Record<string, unknown>>(request);
    const changes = readPersonalFields(body);
    if (!Object.keys(changes).length) {
      throw badRequest("No personal details supplied.");
    }

    const update = buildUpdate("employee_profiles", changes, { id: actor.id });
    if (!update) throw badRequest("No changes supplied.");
    // employee_profiles is keyed by user_id rather than id.
    await env.DB.prepare(update.sql.replace("WHERE id = ?", "WHERE user_id = ?"))
      .bind(...update.binds)
      .run();

    // Stamps the record complete if this was the submission that finished it.
    await settleFirstRun(env, actor.id);

    return json(await ownProfilePayload(env, actor));
  });

  /** The employee's own onboarding screen, in one round trip. */
  router.get("/api/me/onboarding", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    await ensureProfile(env, actor.id);

    const settings = await readSettings(env);
    const [profileRow, items, outstanding, completed] = await env.DB.batch([
      env.DB.prepare(
        `SELECT ${EMPLOYMENT_COLUMNS}, ${PERSONAL_COLUMNS}
           FROM employee_profiles p WHERE p.user_id = ?`,
      ).bind(actor.id),
      env.DB.prepare(
        `SELECT o.*, u.full_name AS done_by_name
           FROM onboarding_items o
           LEFT JOIN users u ON u.id = o.done_by
          WHERE o.user_id = ?
          ORDER BY o.owner DESC, o.position`,
      ).bind(actor.id),
      env.DB.prepare(OUTSTANDING_DOCUMENTS_SQL).bind(actor.id),
      env.DB.prepare(
        `SELECT d.id, d.kind, d.category, d.title, d.summary, d.version, d.status,
                d.requires_signature, d.requires_acknowledgement, d.audience,
                d.assigned_user_id, d.effective_from, d.position, d.published_at,
                d.created_at, d.updated_at,
                s.signed_at, s.action
           FROM document_signatures s
           JOIN documents d ON d.id = s.document_id AND d.version = s.version
          WHERE s.user_id = ?
          ORDER BY s.signed_at DESC`,
      ).bind(actor.id),
    ]);

    const profile = (profileRow.results[0] ?? null) as Record<string, unknown> | null;
    const employeeItems = items.results as Array<Record<string, unknown>>;

    // Progress counts only what the employee themselves can act on.
    const own = employeeItems.filter((item) => item.owner === "employee");
    const progress = computeProgress({
      items_total: own.length,
      items_done: own.filter((item) => item.is_done === 1).length,
      documents_total: outstanding.results.length + completed.results.length,
      documents_done: completed.results.length,
      profile_complete: !!profile?.profile_completed_at,
    });

    /*
     * The whole programme is staged, not only the person's own steps: somebody wants to
     * know what the firm is doing for them as well as what they owe, and a stage that
     * looks unfinished because HR has not ticked something is more useful than one that
     * silently omits it.
     */
    const stages = stageProgress(
      employeeItems as Array<{ stage: string | null; is_done: 0 | 1; owner: string }>,
      profile?.start_date as string | null,
      profile?.probation_end_date as string | null,
    );

    const bank = await ownBank(env, actor.id);

    return json({
      welcome_message: settings.welcome_message,
      md_name: settings.md_name,
      md_title: settings.md_title,
      firm_name: settings.firm_name,
      profile,
      personal: profile,
      bank,
      missing_profile_fields: missingProfileFields(profile),
      /*
       * What is attached, alongside the fields rather than fetched after them: a form
       * that drew the fields first would flash "nothing attached" at somebody who had.
       */
      attachments: await attachmentsFor(env, actor.id),
      missing_bank_fields: missingBankFields(bank),
      /** Everything still outstanding from the first sign-in, both halves together. */
      first_run_complete: Boolean(profile?.profile_completed_at),
      employment_type: (profile?.employment_type as string) ?? null,
      contract_template: contractTemplateFor(
        (profile?.employment_type as EmploymentType) ?? "permanent",
      ),
      items: employeeItems,
      stages: stages.stages,
      current_stage: stages.current,
      outstanding_documents: outstanding.results,
      completed_documents: completed.results,
      progress,
    });
  });

  /** An employee ticks off their own onboarding steps; HR ticks off theirs. */
  router.patch("/api/onboarding-items/:id", async ({ request, env, params }) => {
    // Reachable during the first run: several of the steps being ticked are the first
    // run's own, and a checklist you cannot tick until you have finished it is no use.
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const item = await env.DB.prepare(
      `SELECT id, user_id, owner, label, is_done FROM onboarding_items WHERE id = ?`,
    )
      .bind(params.id)
      .first<{
        id: string;
        user_id: string;
        owner: "employee" | "hr";
        label: string;
        is_done: 0 | 1;
      }>();
    if (!item) throw notFound("That onboarding step does not exist.");

    const admin = isHrAdmin(actor.role);
    if (item.owner === "hr" && !admin) {
      throw forbidden("This step is completed by HR, not by you.");
    }
    if (item.owner === "employee" && item.user_id !== actor.id && !admin) {
      throw forbidden("You can only complete your own onboarding steps.");
    }

    const body = await readJson<{ is_done?: boolean }>(request);
    const done = body.is_done === true;

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE onboarding_items SET is_done = ?, done_at = ?, done_by = ? WHERE id = ?`,
      ).bind(done ? 1 : 0, done ? nowIso() : null, done ? actor.id : null, item.id),
      hrEventStatement(env, {
        subjectId: item.user_id,
        actorId: actor.id,
        kind: done ? "onboarding:completed_step" : "onboarding:reopened_step",
        detail: item.label,
      }),
    ]);

    const updated = await env.DB.prepare(
      `SELECT o.*, u.full_name AS done_by_name
         FROM onboarding_items o LEFT JOIN users u ON u.id = o.done_by
        WHERE o.id = ?`,
    )
      .bind(item.id)
      .first();
    return json({ item: updated });
  });

  // -------------------------------------------------------------------------
  // Directory and personnel files
  // -------------------------------------------------------------------------

  /**
   * The firm-wide staff directory.
   *
   * Open to everybody, unlike `/api/employees` below, which is the personnel directory
   * and is gated. A practice needs a phone list: somebody preparing a return has to be
   * able to find out who reviews for the tax team and which address to use, and asking
   * around for that is how a new joiner spends their first fortnight.
   *
   * What differs by grade is not who appears - everybody does - but what is said about
   * them. `shared/directory.ts` sets out the line and why it falls where it does. The
   * short version: working identity for everybody, employment facts for Manager grade
   * and above, and nothing personal for anybody here at all.
   */
  router.get("/api/directory", async ({ request, env, url }) => {
    // The firm's own setting, enforced here as well as in the sidebar. A directory the
    // firm has switched off has to be refused, not merely unlinked.
    const actor = await requireArea(env, request, "directory");
    const detail = seesEmploymentDetail(actor.role);

    /*
     * Retired accounts are left out. They are kept so that the client work still shows
     * who prepared and who reviewed each job, but a person who has left the firm is not
     * somebody a colleague should be trying to email - and "Former colleague" with a
     * placeholder address is a directory entry nobody can act on.
     *
     * Suspended accounts do stay: somebody on leave is still a colleague.
     */
    const filters: string[] = [];
    const binds: unknown[] = [actor.id];

    const q = url.searchParams.get("q")?.trim();
    if (q) {
      filters.push(
        `(u.full_name LIKE ? OR u.email LIKE ? OR p.job_title LIKE ? OR p.department LIKE ?)`,
      );
      const like = `%${q}%`;
      binds.push(like, like, like, like);
    }
    const where = filters.length ? `AND ${filters.join(" AND ")}` : "";

    /*
     * The columns a reader below Manager grade must never receive are left out of the
     * SELECT rather than deleted from the rows afterwards. Filtering after the fact
     * works until somebody adds a column and forgets the filter; not asking for it
     * cannot fail that way.
     */
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.full_name, u.email, u.role,
              u.status AS account_status,
              p.job_title, p.department, p.work_location,
              ${detail ? "p.employment_status, p.staff_no, p.start_date," : ""}
              m.full_name AS line_manager_name,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.status NOT IN ('closed','cancelled')
                  AND (t.assignee_id = u.id OR t.reviewer_id = u.id)
                  AND (t.assignee_id = ?1 OR t.reviewer_id = ?1)
                  AND u.id != ?1) AS shared_deliverables
         FROM users u
         LEFT JOIN employee_profiles p ON p.user_id = u.id
         LEFT JOIN users m ON m.id = p.line_manager_id
        WHERE u.email NOT LIKE '%@removed.invalid' ${where}
        ORDER BY u.full_name`,
    )
      .bind(...binds)
      .all<Record<string, unknown>>();

    return json({
      people: results.map((row) => ({
        id: row.id,
        full_name: row.full_name,
        role: row.role,
        title: row.job_title ?? null,
        department: row.department ?? null,
        email: row.email,
        work_location: row.work_location ?? null,
        line_manager_name: row.line_manager_name ?? null,
        active: row.account_status === "active",
        shared_deliverables: Number(row.shared_deliverables ?? 0),
        ...(detail
          ? {
              employment_status: row.employment_status ?? null,
              staff_no: row.staff_no ?? null,
              start_date: row.start_date ?? null,
            }
          : {}),
      })),
      // So the screen knows whether to offer a link through to the personnel file.
      can_open_records: canSeeDirectoryOrHr(actor),
    });
  });

  router.get("/api/employees", async ({ request, env, url }) => {
    // Both gates apply. The area setting lets the firm tighten this further than the
    // built-in floor; it can never loosen it past MIN_DIRECTORY_ROLE.
    await requireArea(env, request, "people");
    const actor = await requireRole(env, request, MIN_DIRECTORY_ROLE);

    const filters: string[] = [];
    const binds: unknown[] = [];
    const status = url.searchParams.get("employment_status");
    if (status) {
      filters.push(`p.employment_status = ?`);
      binds.push(optionalEnum(status, "employment_status", EMPLOYMENT_STATUSES));
    }
    const q = url.searchParams.get("q")?.trim();
    if (q) {
      filters.push(`(u.full_name LIKE ? OR u.email LIKE ? OR p.staff_no LIKE ?)`);
      const like = `%${q}%`;
      binds.push(like, like, like);
    }
    const where = filters.length ? `AND ${filters.join(" AND ")}` : "";

    const { results } = await env.DB.prepare(
      `SELECT u.id AS user_id, u.full_name, u.email, u.role,
              u.status AS account_status,
              ${EMPLOYMENT_COLUMNS},
              m.full_name AS line_manager_name,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.assignee_id = u.id
                  AND t.status NOT IN ('closed','cancelled')) AS open_tasks,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.assignee_id = u.id
                  AND t.status NOT IN ('approved','closed','cancelled')
                  AND COALESCE(t.internal_due_date, t.statutory_due_date) IS NOT NULL
                  AND date(COALESCE(t.internal_due_date, t.statutory_due_date))
                        < date('now')) AS overdue_tasks,
              (SELECT COUNT(*) FROM documents d
                WHERE d.status = 'published'
                  AND (d.requires_signature = 1 OR d.requires_acknowledgement = 1)
                  AND (d.audience = 'all' OR d.assigned_user_id = u.id)
                  AND NOT EXISTS (
                    SELECT 1 FROM document_signatures s
                     WHERE s.document_id = d.id AND s.version = d.version
                       AND s.user_id = u.id
                  )) AS outstanding_documents,
              (SELECT COUNT(*) FROM onboarding_items o
                WHERE o.user_id = u.id AND o.is_done = 0) AS onboarding_items_outstanding
         FROM users u
         LEFT JOIN employee_profiles p ON p.user_id = u.id
         LEFT JOIN users m ON m.id = p.line_manager_id
        WHERE 1 = 1 ${where}
        ORDER BY u.full_name`,
    )
      .bind(...binds)
      .all();

    return json({ employees: results, can_administer: isHrAdmin(actor.role) });
  });

  /** The personnel file. Sections appear according to the caller's access. */
  router.get("/api/employees/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const isSelf = actor.id === params.id;
    if (!isSelf && !canSeeDirectoryOrHr(actor)) {
      throw forbidden("You do not have access to employee records.");
    }

    const user = await env.DB.prepare(
      `SELECT id, email, full_name, role, title, status, must_change_password,
              created_at, last_login_at
         FROM users WHERE id = ?`,
    )
      .bind(params.id)
      .first();
    if (!user) throw notFound("That employee does not exist.");

    await ensureProfile(env, params.id);
    const showPersonal = canSeePersonalDetails(actor, params.id);
    const showPay = canSeeCompensation(actor.role) || isSelf;

    const profile = await env.DB.prepare(
      `SELECT ${EMPLOYMENT_COLUMNS}${showPersonal ? `, ${PERSONAL_COLUMNS}` : ""}
         FROM employee_profiles p WHERE p.user_id = ?`,
    )
      .bind(params.id)
      .first<Record<string, unknown>>();

    const [onboarding, docs, signatures, outstanding, events] = await env.DB.batch([
      env.DB.prepare(
        `SELECT o.*, u.full_name AS done_by_name
           FROM onboarding_items o LEFT JOIN users u ON u.id = o.done_by
          WHERE o.user_id = ? ORDER BY o.owner DESC, o.position`,
      ).bind(params.id),
      env.DB.prepare(
        `SELECT e.*, u.full_name AS added_by_name
           FROM employee_documents e LEFT JOIN users u ON u.id = e.added_by
          WHERE e.user_id = ?
            ${isHrAdmin(actor.role) ? "" : "AND e.visible_to_employee = 1"}
          ORDER BY e.added_at DESC`,
      ).bind(params.id),
      env.DB.prepare(
        `SELECT s.*, d.title AS document_title
           FROM document_signatures s
           JOIN documents d ON d.id = s.document_id
          WHERE s.user_id = ? ORDER BY s.signed_at DESC`,
      ).bind(params.id),
      env.DB.prepare(OUTSTANDING_DOCUMENTS_SQL).bind(params.id),
      env.DB.prepare(
        `SELECT h.*, u.full_name AS actor_name
           FROM hr_events h LEFT JOIN users u ON u.id = h.actor_id
          WHERE h.subject_id = ? ORDER BY h.created_at DESC LIMIT 200`,
      ).bind(params.id),
    ]);

    let compensation: unknown = null;
    if (showPay) {
      compensation = await env.DB.prepare(
        `SELECT * FROM employee_compensation WHERE user_id = ?`,
      )
        .bind(params.id)
        .first();
    }

    const ownItems = (onboarding.results as Array<Record<string, unknown>>).filter(
      (item) => item.owner === "employee",
    );
    const progress = computeProgress({
      items_total: onboarding.results.length,
      items_done: (onboarding.results as Array<Record<string, unknown>>).filter(
        (item) => item.is_done === 1,
      ).length,
      documents_total: outstanding.results.length + signatures.results.length,
      documents_done: signatures.results.length,
      profile_complete: !!profile?.profile_completed_at,
    });
    void ownItems;

    return json({
      user,
      profile,
      personal: showPersonal ? profile : null,
      /*
       * The documents this person attached, so the screen can offer them rather than
       * printing the portal's internal reference at somebody.
       *
       * Gated on the same test as the rest of the personal record. This is only the
       * filename and size - the file itself still comes from the download endpoint,
       * which makes its own check, so nothing here widens who can read a passport.
       */
      attachments: showPersonal ? await attachmentsFor(env, String(params.id)) : null,
      compensation,
      onboarding: onboarding.results,
      documents: docs.results,
      signatures: signatures.results,
      outstanding_documents: outstanding.results,
      events: isHrAdmin(actor.role) ? events.results : [],
      progress,
    });
  });

  /** HR maintains the employment record. */
  router.patch("/api/employees/:id", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const exists = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!exists) throw notFound("That employee does not exist.");
    await ensureProfile(env, params.id);

    const body = await readJson<Record<string, unknown>>(request);
    const lineManagerId = optionalId(body.line_manager_id, "line_manager_id");
    await assertExists(env, "users", lineManagerId, "The selected line manager");
    if (lineManagerId === params.id) {
      throw badRequest("An employee cannot be their own line manager.");
    }

    const changes: Record<string, unknown> = {
      staff_no: optionalString(body.staff_no, "staff_no", 24),
      job_title: optionalString(body.job_title, "job_title", 120),
      department: optionalString(body.department, "department", 120),
      employment_type: optionalEnum(
        body.employment_type,
        "employment_type",
        EMPLOYMENT_TYPES,
      ),
      employment_status: optionalEnum(
        body.employment_status,
        "employment_status",
        EMPLOYMENT_STATUSES,
      ),
      start_date: optionalDate(body.start_date, "start_date"),
      probation_end_date: optionalDate(body.probation_end_date, "probation_end_date"),
      confirmed_on: optionalDate(body.confirmed_on, "confirmed_on"),
      exit_date: optionalDate(body.exit_date, "exit_date"),
      line_manager_id: lineManagerId,
      work_location: optionalString(body.work_location, "work_location", 120),
      // HR may also correct personal details on the employee's behalf.
      ...readPersonalFields(body),
    };

    // Only forward keys the caller actually sent.
    for (const key of Object.keys(changes)) {
      if (body[key] === undefined) delete changes[key];
    }
    if (!Object.keys(changes).length) throw badRequest("No changes supplied.");

    const update = buildUpdate("employee_profiles", changes, { id: params.id });
    if (!update) throw badRequest("No changes supplied.");

    await env.DB.batch([
      env.DB.prepare(update.sql.replace("WHERE id = ?", "WHERE user_id = ?")).bind(
        ...update.binds,
      ),
      hrEventStatement(env, {
        subjectId: params.id,
        actorId: actor.id,
        kind: "employment_record:updated",
        detail: `Changed: ${Object.keys(changes).join(", ")}`,
      }),
    ]);

    return json({ ok: true });
  });

  /**
   * The person's own bank details.
   *
   * Separate from the Partner-only compensation endpoint below, and deliberately narrow:
   * it writes four bank columns on the caller's own row and touches nothing else. Salary
   * is not among them - somebody editing their own pay is the one thing this table exists
   * to prevent - and there is no `:id`, so there is no version of this call that reaches
   * anybody else's record.
   *
   * Reachable on a temporary password and before the first run is finished, because
   * giving these details is part of the first run.
   */
  router.patch("/api/me/bank", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const body = await readJson<Record<string, unknown>>(request);

    const fields = {
      bank_name: optionalString(body.bank_name, "bank_name", 120),
      bank_branch: optionalString(body.bank_branch, "bank_branch", 120),
      account_name: optionalString(body.account_name, "account_name", 160),
      account_number: optionalString(body.account_number, "account_number", 60),
    };

    await env.DB.prepare(
      `INSERT INTO employee_compensation
         (user_id, bank_name, bank_branch, account_name, account_number, updated_at, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?1)
       ON CONFLICT (user_id) DO UPDATE SET
         bank_name      = COALESCE(excluded.bank_name, employee_compensation.bank_name),
         bank_branch    = COALESCE(excluded.bank_branch, employee_compensation.bank_branch),
         account_name   = COALESCE(excluded.account_name, employee_compensation.account_name),
         account_number = COALESCE(excluded.account_number, employee_compensation.account_number),
         updated_at     = excluded.updated_at,
         updated_by     = excluded.updated_by`,
    )
      .bind(
        actor.id,
        fields.bank_name,
        fields.bank_branch,
        fields.account_name,
        fields.account_number,
        nowIso(),
      )
      .run();

    await settleFirstRun(env, actor.id);
    return json({ bank: await ownBank(env, actor.id) });
  });

  /** Pay and bank details. Partner grade only, on read and on write. */
  router.patch("/api/employees/:id/compensation", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    if (!canSeeCompensation(actor.role)) {
      throw forbidden("Pay details are restricted to Partner grade and above.");
    }
    const exists = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!exists) throw notFound("That employee does not exist.");

    const body = await readJson<Record<string, unknown>>(request);
    const timestamp = nowIso();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO employee_compensation
           (user_id, annual_salary, currency, pay_frequency, bank_name, bank_branch,
            account_name, account_number, tax_identification_no, social_security_no,
            notes, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           annual_salary         = excluded.annual_salary,
           currency              = excluded.currency,
           pay_frequency         = excluded.pay_frequency,
           bank_name             = excluded.bank_name,
           bank_branch           = excluded.bank_branch,
           account_name          = excluded.account_name,
           account_number        = excluded.account_number,
           tax_identification_no = excluded.tax_identification_no,
           social_security_no    = excluded.social_security_no,
           notes                 = excluded.notes,
           updated_at            = excluded.updated_at,
           updated_by            = excluded.updated_by`,
      ).bind(
        params.id,
        optionalNumber(body.annual_salary, "annual_salary", { max: 100_000_000 }),
        optionalString(body.currency, "currency", 3) ?? "GHS",
        optionalEnum(body.pay_frequency, "pay_frequency", PAY_FREQUENCIES) ?? "monthly",
        optionalString(body.bank_name, "bank_name", 120),
        optionalString(body.bank_branch, "bank_branch", 120),
        optionalString(body.account_name, "account_name", 120),
        optionalString(body.account_number, "account_number", 40),
        optionalString(body.tax_identification_no, "tax_identification_no", 40),
        optionalString(body.social_security_no, "social_security_no", 40),
        optionalString(body.notes, "notes", 2000),
        timestamp,
        actor.id,
      ),
      // The values are not written to the trail - only the fact of the change.
      hrEventStatement(env, {
        subjectId: params.id,
        actorId: actor.id,
        kind: "compensation:updated",
        detail: "Pay or bank details amended",
      }),
    ]);

    const compensation = await env.DB.prepare(
      `SELECT * FROM employee_compensation WHERE user_id = ?`,
    )
      .bind(params.id)
      .first();
    return json({ compensation });
  });

  // -------------------------------------------------------------------------
  // Onboarding administration
  // -------------------------------------------------------------------------

  /** Starts the standard onboarding programme for a new joiner. */
  router.post("/api/employees/:id/onboarding", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const user = await env.DB.prepare(`SELECT id, full_name FROM users WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string; full_name: string }>();
    if (!user) throw notFound("That employee does not exist.");

    const existing = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM onboarding_items WHERE user_id = ?`,
    )
      .bind(params.id)
      .first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) {
      throw badRequest(
        "This employee already has an onboarding programme. Add individual steps instead.",
      );
    }

    const started = await startOnboardingProgramme(env, params.id, actor.id);

    return json(
      {
        ok: true,
        created: started.created,
        employment_type: started.employment_type,
        contract_template: contractTemplateFor(started.employment_type),
      },
      201,
    );
  });

  /** Adds a one-off onboarding step for an individual. */
  router.post("/api/employees/:id/onboarding-items", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<Record<string, unknown>>(request);
    const label = requireString(body.label, "label", { max: 300 });
    const owner = optionalEnum(body.owner, "owner", ["employee", "hr"] as const) ?? "hr";

    const next = await env.DB.prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 AS position
         FROM onboarding_items WHERE user_id = ?`,
    )
      .bind(params.id)
      .first<{ position: number }>();

    const id = newId();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO onboarding_items
           (id, user_id, position, label, detail, owner, category, is_done, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).bind(
        id,
        params.id,
        next?.position ?? 0,
        label,
        optionalString(body.detail, "detail", 1000),
        owner,
        optionalString(body.category, "category", 60),
        nowIso(),
      ),
      hrEventStatement(env, {
        subjectId: params.id,
        actorId: actor.id,
        kind: "onboarding:step_added",
        detail: label,
      }),
    ]);

    return json({ ok: true, id }, 201);
  });

  // -------------------------------------------------------------------------
  // Personnel file documents
  // -------------------------------------------------------------------------

  router.post("/api/employees/:id/documents", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);

    // Checked up front so an unknown employee is a 404 rather than a foreign-key
    // violation surfacing as "Internal server error", as every other route here
    // does.
    const exists = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!exists) throw notFound("That employee does not exist.");

    const body = await readJson<Record<string, unknown>>(request);
    const label = requireString(body.label, "label", { max: 200 });
    const url = requireString(body.url, "url", { max: 2000 });

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw badRequest("That does not look like a valid URL.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw badRequest("Document links must start with https:// or http://");
    }

    const id = newId();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO employee_documents
           (id, user_id, label, category, url, visible_to_employee, expires_on,
            added_by, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        params.id,
        label,
        optionalString(body.category, "category", 80),
        parsed.toString(),
        body.visible_to_employee === false ? 0 : 1,
        optionalDate(body.expires_on, "expires_on"),
        actor.id,
        nowIso(),
      ),
      hrEventStatement(env, {
        subjectId: params.id,
        actorId: actor.id,
        kind: "personnel_file:document_added",
        detail: label,
      }),
    ]);

    return json({ ok: true, id }, 201);
  });

  /** HR overview of everyone still being onboarded. */
  router.get("/api/onboarding", async ({ request, env }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);

    const { results } = await env.DB.prepare(
      `SELECT u.id AS user_id, u.full_name, u.email,
              p.job_title, p.department, p.start_date, p.employment_status,
              p.profile_completed_at,
              (SELECT COUNT(*) FROM onboarding_items o
                WHERE o.user_id = u.id) AS items_total,
              (SELECT COUNT(*) FROM onboarding_items o
                WHERE o.user_id = u.id AND o.is_done = 1) AS items_done,
              (SELECT COUNT(*) FROM document_signatures s
                JOIN documents d ON d.id = s.document_id AND d.version = s.version
               WHERE s.user_id = u.id) AS documents_done,
              (SELECT COUNT(*) FROM documents d
                WHERE d.status = 'published'
                  AND (d.requires_signature = 1 OR d.requires_acknowledgement = 1)
                  AND (d.audience = 'all' OR d.assigned_user_id = u.id)
                  AND NOT EXISTS (
                    SELECT 1 FROM document_signatures s
                     WHERE s.document_id = d.id AND s.version = d.version
                       AND s.user_id = u.id
                  )) AS documents_outstanding
         FROM users u
         LEFT JOIN employee_profiles p ON p.user_id = u.id
        WHERE u.status = 'active'
        ORDER BY
          CASE p.employment_status WHEN 'onboarding' THEN 0 WHEN 'probation' THEN 1 ELSE 2 END,
          p.start_date DESC,
          u.full_name`,
    ).all<Record<string, number | string | null>>();

    const rows = results.map((row) => ({
      ...row,
      progress: computeProgress({
        items_total: Number(row.items_total ?? 0),
        items_done: Number(row.items_done ?? 0),
        documents_total:
          Number(row.documents_done ?? 0) + Number(row.documents_outstanding ?? 0),
        documents_done: Number(row.documents_done ?? 0),
        profile_complete: !!row.profile_completed_at,
      }),
    }));

    return json({ employees: rows });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canSeeDirectoryOrHr(actor: AuthenticatedUser): boolean {
  return isHrAdmin(actor.role) || actor.role === "manager";
}

/**
 * Every user gets an employment record lazily, the first time one is needed.
 * That keeps user creation simple and means records created before this feature
 * existed still work.
 */
/**
 * Creates somebody's onboarding programme.
 *
 * Called when an account is created, so that a new joiner signing in for the first time
 * meets the Managing Director's welcome and their own checklist - and called again by
 * the administrator's "start the programme" action, for accounts that pre-date this or
 * whose programme was cleared.
 *
 * Shared rather than duplicated because the first-run gate is built on this: a person
 * with no programme is treated as having nothing outstanding and is sent straight to the
 * password step. That rule is what keeps a founder who was never onboarded out of a gate
 * meant for new joiners, and it is also why a new joiner who never got a programme
 * silently skipped their onboarding. One function, so the two cannot drift apart.
 *
 * Returns `created: 0` and changes nothing if a programme already exists. Rebuilding one
 * would duplicate every step and reset dates somebody may already have worked to.
 */
export async function startOnboardingProgramme(
  env: Env,
  userId: string,
  actorId: string | null,
): Promise<{ created: number; employment_type: EmploymentType }> {
  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM onboarding_items WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ n: number }>();

  await ensureProfile(env, userId);

  /*
   * Which programme, and dated from what.
   *
   * The employment type is read from the record the administrator has already set
   * rather than passed in here, so the checklist somebody gets always matches the
   * engagement the firm recorded for them. Change the type before starting the
   * programme, not after.
   */
  const record = await env.DB.prepare(
    `SELECT employment_type, start_date, probation_end_date
       FROM employee_profiles WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{
      employment_type: EmploymentType;
      start_date: string | null;
      probation_end_date: string | null;
    }>();

  const employmentType = record?.employment_type ?? "permanent";
  if ((existing?.n ?? 0) > 0) return { created: 0, employment_type: employmentType };

  const programme = programmeFor(employmentType);
  const timestamp = nowIso();

  await env.DB.batch([
    ...programme.map((item, index) =>
      env.DB.prepare(
        `INSERT INTO onboarding_items
           (id, user_id, position, label, detail, owner, category, stage, due_date,
            is_done, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).bind(
        newId(),
        userId,
        index,
        item.label,
        item.detail ?? null,
        item.owner,
        item.category,
        item.stage,
        /*
         * Dated once, when the programme is created, rather than derived on every read.
         * A step's due date should not move because somebody later corrected the start
         * date by a day - if the dates need redoing, the programme is rebuilt.
         */
        stageDueDate(item.stage, record?.start_date, record?.probation_end_date),
        timestamp,
      ),
    ),
    hrEventStatement(env, {
      subjectId: userId,
      actorId,
      kind: "onboarding:started",
      detail: `${programme.length} steps created for a ${EMPLOYMENT_TYPE_LABELS[employmentType].toLowerCase()} engagement`,
    }),
    notificationStatement(env, {
      userId,
      taskId: null,
      kind: "hr:onboarding_started",
      title: "Your onboarding is ready",
      body: "Your checklist shows what happens when, and how far through you are.",
    }),
  ]);

  return { created: programme.length, employment_type: employmentType };
}

export async function ensureProfile(env: Env, userId: string): Promise<void> {
  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO employee_profiles (user_id, created_at, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO NOTHING`,
  )
    .bind(userId, timestamp, timestamp)
    .run();
}

function readPersonalFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of PERSONAL_FIELDS) {
    if (body[field] === undefined) continue;
    if (field === "date_of_birth") {
      out[field] = optionalDate(body[field], field);
      continue;
    }
    const value = optionalString(
      body[field],
      field,
      field === "residential_address" || field === "right_to_work_note" ? 500 : 300,
    );
    /*
     * Document links are restricted to http and https, exactly as the client file is:
     * a stored `javascript:` address would run in a colleague's session the moment
     * somebody with HR access clicked it.
     */
    if (
      value &&
      field.endsWith("_url") &&
      !/^https?:\/\//i.test(value) &&
      /*
       * The portal's own reference to a file somebody attached, which is not a link
       * anybody clicks - the screen turns it into a request to the download endpoint.
       * Allowed by exact scheme rather than by relaxing the rule: the rule is what stops
       * a stored `javascript:` address running in a colleague's session the moment
       * somebody with HR access clicks it, and it is worth keeping intact.
       *
       * Nothing is trusted from it beyond the fact that it is one. Which file is handed
       * back is decided by whose record it is and which kind was asked for, never by
       * what this column says, so a reference to somebody else's file reaches nothing.
       */
      !isAttachment(value)
    ) {
      throw badRequest(
        `"${field}" must be a link beginning http:// or https://, or a file attached on this screen.`,
      );
    }
    out[field] = value;
  }
  return out;
}

/** The caller's own bank fields. Never salary, which is a different question. */
export async function ownBank(env: Env, userId: string) {
  return env.DB.prepare(
    `SELECT bank_name, bank_branch, account_name, account_number
       FROM employee_compensation WHERE user_id = ?`,
  )
    .bind(userId)
    .first<Record<string, unknown>>();
}

/**
 * What is still outstanding before somebody has finished their first sign-in.
 *
 * Both halves, from the two tables they live in. Exported because `worker/auth.ts` asks
 * the same question on every request in order to decide whether to confine somebody to
 * the form.
 */
export async function missingFirstRun(env: Env, userId: string): Promise<string[]> {
  const [profile, bank] = await Promise.all([
    env.DB.prepare(
      `SELECT ${PERSONAL_COLUMNS} FROM employee_profiles p WHERE p.user_id = ?`,
    )
      .bind(userId)
      .first<Record<string, unknown>>(),
    ownBank(env, userId),
  ]);
  return [...missingProfileFields(profile), ...missingBankFields(bank)];
}

/**
 * Stamps the profile as complete once nothing is outstanding.
 *
 * Called from both halves of the form, since either can be the one that finishes it.
 */
export async function settleFirstRun(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT profile_completed_at FROM employee_profiles WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ profile_completed_at: string | null }>();
  if (row?.profile_completed_at) return true;

  if ((await missingFirstRun(env, userId)).length > 0) return false;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE employee_profiles SET profile_completed_at = ? WHERE user_id = ?`,
    ).bind(nowIso(), userId),
    hrEventStatement(env, {
      subjectId: userId,
      actorId: userId,
      kind: "profile:completed",
      detail: "Employee completed everything asked at first sign-in",
    }),
  ]);
  return true;
}

async function ownProfilePayload(env: Env, actor: AuthenticatedUser) {
  await ensureProfile(env, actor.id);
  const profile = await env.DB.prepare(
    `SELECT ${EMPLOYMENT_COLUMNS}, ${PERSONAL_COLUMNS},
            m.full_name AS line_manager_name
       FROM employee_profiles p
       LEFT JOIN users m ON m.id = p.line_manager_id
      WHERE p.user_id = ?`,
  )
    .bind(actor.id)
    .first<Record<string, unknown>>();

  return {
    profile,
    personal: profile,
    missing_profile_fields: missingProfileFields(profile),
  };
}
