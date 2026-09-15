import type { Env } from "../env";
import {
  assertPasswordPolicy,
  generateTemporaryPassword,
  hashPassword,
  requireRole,
  requireUser,
  type AuthenticatedUser,
} from "../auth";
import {
  buildUpdate,
  newId,
  normaliseEmail,
  nowIso,
  optionalString,
  requireEnum,
  requireString,
} from "../db";
import { Router, badRequest, conflict, forbidden, json, notFound, readJson } from "../http";
import { ROLES, ROLE_LABELS, ROLE_RANK, type Role } from "../../shared/workflow";
import {
  REMOVALS,
  RETIRED_NAME,
  type RemovalFootprint,
  adviseRemoval,
  confirmationMatches,
  isRetiredEmail,
  removalConfirmation,
  retiredEmail,
} from "../../shared/removal";
import { sendToPerson } from "../email";
import { readSettings } from "./settings";

/** Grade required to administer staff records. */
const MIN_USER_ADMIN: Role = "partner";

export function registerUserRoutes(router: Router<Env>): void {
  /** Directory listing. Every signed-in user needs this for assignee pickers. */
  router.get("/api/users", async ({ request, env, url }) => {
    const actor = await requireUser(env, request);
    const includeSuspended = url.searchParams.get("include_suspended") === "1";

    const { results } = await env.DB.prepare(
      `SELECT id, email, full_name, role, title, status, must_change_password,
              email_notifications,
              created_at, last_login_at
         FROM users
        ${includeSuspended ? "" : "WHERE status = 'active'"}
        ORDER BY CASE role
                   WHEN 'admin' THEN 1 WHEN 'partner' THEN 2 WHEN 'manager' THEN 3
                   WHEN 'senior_associate' THEN 4 ELSE 5 END,
                 full_name`,
    ).all();

    // Only staff administrators see the account-hygiene fields.
    const canSeeAdminFields = ROLE_RANK[actor.role] >= ROLE_RANK[MIN_USER_ADMIN];
    const users = canSeeAdminFields
      ? results
      : results.map((row) => {
          const { must_change_password: _m, last_login_at: _l, ...rest } = row as Record<
            string,
            unknown
          >;
          return rest;
        });

    return json({ users });
  });

  router.post("/api/users", async ({ request, env, url }) => {
    const actor = await requireRole(env, request, MIN_USER_ADMIN);
    const body = await readJson<{
      email?: string;
      full_name?: string;
      role?: string;
      title?: string;
      password?: string;
      send_invitation?: boolean;
    }>(request);

    const email = normaliseEmail(body.email);
    const fullName = requireString(body.full_name, "full_name", { max: 120 });
    const role = requireEnum(body.role, "role", ROLES);
    const title = optionalString(body.title, "title", 120);

    assertCanGrantRole(actor.role, role);

    const clash = await env.DB.prepare(
      `SELECT id FROM users WHERE lower(email) = ?`,
    )
      .bind(email)
      .first<{ id: string }>();
    if (clash) throw conflict("A user with that email address already exists.");

    // An explicit password is allowed (useful for scripted setup); otherwise we
    // issue a temporary one the user must change at first sign-in.
    let password: string;
    let mustChange: 0 | 1;
    if (body.password) {
      assertPasswordPolicy(body.password);
      password = body.password;
      mustChange = 0;
    } else {
      password = generateTemporaryPassword();
      mustChange = 1;
    }

    const id = newId();
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO users (id, email, full_name, role, title, status, password_hash,
                          must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
      .bind(
        id,
        email,
        fullName,
        role,
        title,
        await hashPassword(env, password),
        mustChange,
        timestamp,
        timestamp,
      )
      .run();

    // The invitation is sent inside the request rather than in waitUntil, because
    // the screen has to tell the administrator whether it went: "invitation sent" and
    // "write the password down, it did not send" are different instructions, and
    // guessing wrong means a new joiner with no way in.
    let invitation: { sent: boolean; error?: string } = {
      sent: false,
      error: "No invitation was requested.",
    };
    if (body.send_invitation !== false && mustChange) {
      const settings = await readSettings(env);
      const portal = (env.PORTAL_URL ?? "").trim().replace(/\/+$/, "") || url.origin;
      invitation = await sendToPerson(env, {
        to: { email, full_name: fullName },
        subject: `Your ${settings.firm_name} portal account`,
        headline: `${actor.full_name} has created your account on the ${settings.firm_name} staff portal. Sign in with this email address and the temporary password below, and you will be asked to choose your own password straight away.`,
        detail: `Email address: ${email}\nTemporary password: ${password}`,
        link: `${portal}/login`,
        linkLabel: "Sign in to the portal",
        firmName: settings.firm_name,
        reason: `an account has been created for you at ${settings.firm_name}`,
      });
    }

    return json(
      {
        user: { id, email, full_name: fullName, role, title, status: "active" },
        // Shown once so the administrator can pass it on out of band. Still returned
        // when the invitation was sent: the email can be delayed, filtered or bounce,
        // and the administrator needs the fallback in front of them either way.
        temporary_password: mustChange ? password : null,
        invitation_sent: invitation.sent,
        invitation_error: invitation.sent ? null : (invitation.error ?? null),
      },
      201,
    );
  });

  router.patch("/api/users/:id", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_USER_ADMIN);
    const target = await env.DB.prepare(
      `SELECT id, email, full_name, role, status FROM users WHERE id = ?`,
    )
      .bind(params.id)
      .first<{
        id: string;
        email: string;
        full_name: string;
        role: Role;
        status: string;
      }>();
    if (!target) throw notFound("That user does not exist.");

    const body = await readJson<{
      full_name?: string;
      email?: string;
      role?: string;
      title?: string | null;
      status?: string;
    }>(request);

    // You may not act on someone senior to you.
    if (ROLE_RANK[target.role] > ROLE_RANK[actor.role]) {
      throw forbidden(
        `You cannot modify a ${ROLE_LABELS[target.role]} account from your grade.`,
      );
    }

    const nextRole =
      body.role === undefined ? undefined : requireEnum(body.role, "role", ROLES);
    if (nextRole) assertCanGrantRole(actor.role, nextRole);

    const nextStatus =
      body.status === undefined
        ? undefined
        : requireEnum(body.status, "status", ["active", "suspended"] as const);

    if (target.id === actor.id) {
      if (nextStatus === "suspended") {
        throw badRequest("You cannot suspend your own account.");
      }
      if (nextRole && ROLE_RANK[nextRole] < ROLE_RANK[actor.role]) {
        throw badRequest("You cannot reduce your own grade.");
      }
    }

    // Never leave the deployment without an active administrator.
    if (
      target.role === "admin" &&
      (nextStatus === "suspended" || (nextRole && nextRole !== "admin"))
    ) {
      const remaining = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM users
          WHERE role = 'admin' AND status = 'active' AND id != ?`,
      )
        .bind(target.id)
        .first<{ n: number }>();
      if ((remaining?.n ?? 0) === 0) {
        throw badRequest(
          "This is the last active administrator. Promote another user first.",
        );
      }
    }

    /*
     * The email address is the sign-in identifier, so changing it is not the same kind
     * of edit as changing a job title. Three things follow.
     *
     * It must stay unique, and the clash has to be reported as a sentence rather than
     * reaching the caller as a constraint violation.
     *
     * The person has to be told, at both addresses. Somebody whose sign-in address is
     * changed without warning simply cannot get in, and will not know why; and a change
     * nobody sees at the old address is also how an account is quietly taken over.
     *
     * And a retired account's address is left alone. It is a placeholder on a reserved
     * domain that exists to be unroutable, and editing it back into something deliverable
     * would undo the removal.
     */
    let nextEmail: string | undefined;
    if (body.email !== undefined) {
      nextEmail = normaliseEmail(body.email);
      if (nextEmail !== target.email) {
        if (isRetiredEmail(target.email)) {
          throw badRequest(
            "This account has been retired. Its address cannot be changed.",
          );
        }
        const clash = await env.DB.prepare(
          `SELECT id FROM users WHERE lower(email) = ? AND id != ?`,
        )
          .bind(nextEmail, target.id)
          .first<{ id: string }>();
        if (clash) throw conflict("Another account already uses that email address.");
      } else {
        // Unchanged: not worth an update, an email, or a line in the trail.
        nextEmail = undefined;
      }
    }

    const update = buildUpdate(
      "users",
      {
        full_name:
          body.full_name === undefined
            ? undefined
            : requireString(body.full_name, "full_name", { max: 120 }),
        email: nextEmail,
        title:
          body.title === undefined ? undefined : optionalString(body.title, "title", 120),
        role: nextRole,
        status: nextStatus,
      },
      { id: target.id },
    );
    if (!update) throw badRequest("No changes supplied.");

    await env.DB.prepare(update.sql)
      .bind(...update.binds)
      .run();

    // Suspension takes effect immediately, not at session expiry.
    if (nextStatus === "suspended") {
      await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`)
        .bind(target.id)
        .run();
    }

    if (nextEmail) {
      await env.DB.prepare(
        `INSERT INTO hr_events (id, subject_id, actor_id, kind, detail, created_at)
         VALUES (?, ?, ?, 'account:email_changed', ?, ?)`,
      )
        .bind(
          newId(),
          target.id,
          actor.id,
          `From ${target.email} to ${nextEmail}`,
          nowIso(),
        )
        .run();

      /*
       * Both addresses, and inside the request rather than in waitUntil, so the
       * administrator is told whether the person actually heard about it. Best-effort:
       * a change that saved must not be reported as failed because a mail server was
       * slow.
       */
      const settings = await readSettings(env);
      const name = body.full_name ?? target.full_name;
      for (const [address, headline] of [
        [
          nextEmail,
          `${actor.full_name} has changed the email address on your ${settings.firm_name} portal account. Sign in with this address from now on.`,
        ],
        [
          target.email,
          `${actor.full_name} has changed the email address on your ${settings.firm_name} portal account to ${nextEmail}. If you did not expect this, tell a Partner straight away.`,
        ],
      ] as const) {
        try {
          await sendToPerson(env, {
            to: { email: address, full_name: name },
            subject: `Your ${settings.firm_name} portal sign-in address has changed`,
            headline,
            link: `${(env.PORTAL_URL ?? "").trim().replace(/\/+$/, "")}/login`,
            linkLabel: "Sign in to the portal",
            firmName: settings.firm_name,
            reason: "the sign-in address on your account was changed",
          });
        } catch {
          // Told in the response instead; see below.
        }
      }
    }

    const user = await env.DB.prepare(
      `SELECT id, email, full_name, role, title, status, must_change_password,
              email_notifications,
              created_at, last_login_at
         FROM users WHERE id = ?`,
    )
      .bind(target.id)
      .first();
    return json({
      user,
      // So the screen can say "and they have been told", or not.
      email_changed: nextEmail ? { from: target.email, to: nextEmail } : null,
    });
  });

  /**
   * What removing this person would cost, before anybody removes them.
   *
   * Changes nothing, and is meant to be read. "Delete the account" sounds like one
   * action on one row; in this schema a user row is referenced by forty-odd columns and
   * about a third of them cascade, so the plain delete takes review rounds, review
   * points, comments and logged hours off *other people's* deliverables too. That was
   * measured rather than assumed: deleting a reviewer leaves the deliverable they were
   * reviewing in `under_review` with no reviewer and no record of what was asked for.
   */
  router.get("/api/users/:id/removal", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_USER_ADMIN);
    const target = await env.DB.prepare(
      `SELECT id, email, full_name, role, status FROM users WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; email: string; full_name: string; role: Role; status: string }>();
    if (!target) throw notFound("That user does not exist.");

    const footprint = await countFootprint(env, target.id);
    return json({
      user: {
        id: target.id,
        full_name: target.full_name,
        email: target.email,
        role: target.role,
        status: target.status,
      },
      footprint,
      advice: adviseRemoval(footprint),
      // Said here rather than discovered at the point of failure.
      blocked: await removalBlocker(env, actor, target),
      confirmation: removalConfirmation(target.full_name),
    });
  });

  /**
   * Removes somebody, one of two ways.
   *
   * `retire` keeps the user row, anonymised, and deletes the personal record. The client
   * work is left exactly as it is, which is what a practice needs: an audit file has to
   * show that a named person prepared a return and another reviewed it, and a firm that
   * deletes that has lost the file rather than tidied it.
   *
   * `erase` really does delete the row, cascades and all. Offered because it is what an
   * administrator wants for the common case - an account created by mistake - and
   * permitted in every case because it is the firm's data. What it costs is counted,
   * returned by the preview above, and repeated in the response.
   */
  router.delete("/api/users/:id", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_USER_ADMIN);
    const target = await env.DB.prepare(
      `SELECT id, email, full_name, role, status FROM users WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; email: string; full_name: string; role: Role; status: string }>();
    if (!target) throw notFound("That user does not exist.");

    const body = await readJson<{ removal?: unknown; confirmation?: unknown }>(request);
    const removal = requireEnum(body.removal, "removal", REMOVALS);

    const blocker = await removalBlocker(env, actor, target);
    if (blocker) throw badRequest(blocker);

    /*
     * The confirmation is the person's own name rather than a fixed word. "DELETE" can
     * be typed without reading; the point is not friction but making somebody look at
     * which person they have selected before the row goes.
     */
    if (!confirmationMatches(String(body.confirmation ?? ""), target.full_name)) {
      throw badRequest(
        `Type “${removalConfirmation(target.full_name)}” to confirm which account this is.`,
      );
    }

    const footprint = await countFootprint(env, target.id);
    const timestamp = nowIso();

    if (removal === "erase") {
      /*
       * The HR trail entry is written first and against nobody, because `hr_events`
       * cascades on `subject_id` - filed against the person being deleted, the record
       * that they were deleted would be deleted with them.
       */
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO hr_events (id, subject_id, actor_id, kind, detail, created_at)
           VALUES (?, NULL, ?, 'account:deleted', ?, ?)`,
        ).bind(
          newId(),
          actor.id,
          `${target.full_name} (${target.email}) deleted entirely. ` +
            `Removed with them: ${describeFootprint(footprint)}.`,
          timestamp,
        ),
        env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(target.id),
      ]);

      return json({ removed: "erase", footprint });
    }

    /*
     * Retiring. Every statement in one batch, which in D1 is one transaction, so there
     * is no state in which the personal record is half gone and the account still signs
     * in under its own name.
     *
     * The user row is written last. The rows below are found by user_id, and a row
     * updated before them is still the same row - but keeping the order explicit means
     * the account stops being reachable at the same instant its record goes, rather than
     * a moment after.
     */
    const statements = [
      ...PERSONAL_TABLES.map((table) =>
        env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(target.id),
      ),
      // Documents addressed to them alone: their contract, their personnel-file papers.
      env.DB.prepare(
        `DELETE FROM documents WHERE audience = 'individual' AND assigned_user_id = ?`,
      ).bind(target.id),
      // Reviews about them, and the objectives carried in them.
      env.DB.prepare(`DELETE FROM performance_reviews WHERE subject_id = ?`).bind(
        target.id,
      ),
      // The HR trail about them as a person. Written before it goes.
      env.DB.prepare(
        `INSERT INTO hr_events (id, subject_id, actor_id, kind, detail, created_at)
         VALUES (?, NULL, ?, 'account:retired', ?, ?)`,
      ).bind(
        newId(),
        actor.id,
        `${target.full_name} (${target.email}) retired. Personal record removed; ` +
          `${describeFootprint(footprint)} kept so the client work stays complete.`,
        timestamp,
      ),
      env.DB.prepare(`DELETE FROM hr_events WHERE subject_id = ?`).bind(target.id),
      // Somebody else's record must not keep pointing at them as a line manager.
      env.DB.prepare(
        `UPDATE employee_profiles SET line_manager_id = NULL WHERE line_manager_id = ?`,
      ).bind(target.id),
      /*
       * Live client allocations are closed rather than kept.
       *
       * An allocation is not a historical fact like "who reviewed this return" - it is
       * an ongoing obligation with a fee attached, and somebody who has left the firm
       * cannot hold one. Left alone, the client screen would show the work allocated to
       * "Former colleague", and the person who has to reallocate it would have no
       * indication that it needs reallocating.
       *
       * Ended rather than deleted: who held the client, and until when, is exactly the
       * kind of thing an audit file needs, and it is the client work half of the record
       * that this removal is meant to leave intact.
       */
      env.DB.prepare(
        `UPDATE client_allocations
            SET status = 'ended', ended_at = ?, ended_by = ?,
                ended_note = 'Ended automatically: the person left the firm.'
          WHERE user_id = ? AND status IN ('offered', 'accepted')`,
      ).bind(timestamp, actor.id, target.id),
      /*
       * Anonymised rather than deleted. The address goes to a reserved domain that
       * cannot route, the password hash is replaced with a value no password produces,
       * and the account is suspended - so it holds the shape of who did what without
       * being an account anybody can use.
       */
      env.DB.prepare(
        `UPDATE users
            SET full_name = ?, email = ?, title = NULL, status = 'suspended',
                password_hash = ?, must_change_password = 0,
                email_notifications = 0, updated_at = ?
          WHERE id = ?`,
      ).bind(
        RETIRED_NAME,
        retiredEmail(target.id),
        `retired:${newId()}`,
        timestamp,
        target.id,
      ),
    ];

    await env.DB.batch(statements);
    return json({ removed: "retire", footprint });
  });

  router.post("/api/users/:id/reset-password", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_USER_ADMIN);
    const target = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string; role: Role }>();
    if (!target) throw notFound("That user does not exist.");
    if (ROLE_RANK[target.role] > ROLE_RANK[actor.role]) {
      throw forbidden("You cannot reset the password of a more senior user.");
    }

    const password = generateTemporaryPassword();
    await env.DB.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ?
        WHERE id = ?`,
    )
      .bind(await hashPassword(env, password), nowIso(), target.id)
      .run();

    // Force the user back through sign-in with the new credential.
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`)
      .bind(target.id)
      .run();

    return json({ temporary_password: password });
  });
}

/** You may only grant a grade at or below your own. */
function assertCanGrantRole(actorRole: Role, targetRole: Role): void {
  if (ROLE_RANK[targetRole] > ROLE_RANK[actorRole]) {
    throw forbidden(
      `You cannot grant the ${ROLE_LABELS[targetRole]} grade from your own grade.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Removing somebody
// ---------------------------------------------------------------------------

/**
 * The tables that hold facts about a person rather than work they did.
 *
 * Everything here is keyed by `user_id` and goes under either removal. Listed rather
 * than left to the schema's own cascades because a retirement keeps the user row, so
 * nothing cascades - these have to be named, and naming them is also the only way to
 * read off what a retirement actually deletes.
 */
const PERSONAL_TABLES = [
  "sessions",
  "user_totp",
  "recovery_codes",
  "user_security_questions",
  "trusted_devices",
  "login_challenges",
  "notifications",
  "employee_profiles",
  "employee_compensation",
  "employee_documents",
  "onboarding_items",
  "contract_details",
  "status_reports",
  "document_signatures",
] as const;

/**
 * What the person is attached to that belongs to the firm.
 *
 * One batch, and only counts - the preview is read before a decision, not after, so it
 * has to be cheap enough to call whenever a name is selected.
 */
async function countFootprint(env: Env, userId: string): Promise<RemovalFootprint> {
  const results = await env.DB.batch<{ n: number }>([
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM tasks
        WHERE assignee_id = ?1 OR reviewer_id = ?1 OR submitted_by = ?1 OR created_by = ?1`,
    ).bind(userId),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM task_reviews WHERE reviewer_id = ?1 OR submitted_by = ?1`,
    ).bind(userId),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM review_points WHERE raised_by = ?`).bind(
      userId,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM task_comments WHERE author_id = ?`).bind(
      userId,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM time_entries WHERE user_id = ?`).bind(
      userId,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM document_signatures WHERE user_id = ?`,
    ).bind(userId),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT id FROM clients WHERE partner_id = ?1 OR manager_id = ?1
         UNION
         SELECT client_id FROM client_allocations
          WHERE user_id = ?1 AND status IN ('offered','accepted')
       )`,
    ).bind(userId),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM performance_reviews
        WHERE subject_id = ?1 OR reviewer_id = ?1`,
    ).bind(userId),
  ]);

  const at = (i: number) => Number(results[i]?.results[0]?.n ?? 0);
  return {
    tasks: at(0),
    reviews: at(1),
    review_points: at(2),
    comments: at(3),
    time_entries: at(4),
    signatures: at(5),
    clients: at(6),
    performance_reviews: at(7),
  };
}

/** The footprint as a phrase, for the line written into the HR trail. */
function describeFootprint(footprint: RemovalFootprint): string {
  const parts = Object.entries(footprint)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} ${key.replace(/_/g, " ")}`);
  return parts.length ? parts.join(", ") : "nothing";
}

/**
 * Why this person cannot be removed at all, if they cannot.
 *
 * Returned by the preview as well as checked at the point of action, so an
 * administrator reads the reason before choosing rather than after confirming.
 */
async function removalBlocker(
  env: Env,
  actor: AuthenticatedUser,
  target: { id: string; role: Role },
): Promise<string | null> {
  const targetRole: Role = target.role;
  if (target.id === actor.id) {
    return "You cannot remove your own account.";
  }
  if (ROLE_RANK[targetRole] > ROLE_RANK[actor.role]) {
    return `You cannot remove a ${ROLE_LABELS[targetRole]} account from your grade.`;
  }
  if (targetRole === "admin") {
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users
        WHERE role = 'admin' AND status = 'active' AND id != ?`,
    )
      .bind(target.id)
      .first<{ n: number }>();
    if ((remaining?.n ?? 0) === 0) {
      return "This is the last active administrator. Promote another user first.";
    }
  }
  return null;
}
