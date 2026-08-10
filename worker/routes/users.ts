import type { Env } from "../env";
import {
  assertPasswordPolicy,
  generateTemporaryPassword,
  hashPassword,
  requireRole,
  requireUser,
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
      `SELECT id, role, status FROM users WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; role: Role; status: string }>();
    if (!target) throw notFound("That user does not exist.");

    const body = await readJson<{
      full_name?: string;
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

    const update = buildUpdate(
      "users",
      {
        full_name:
          body.full_name === undefined
            ? undefined
            : requireString(body.full_name, "full_name", { max: 120 }),
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

    const user = await env.DB.prepare(
      `SELECT id, email, full_name, role, title, status, must_change_password,
              email_notifications,
              created_at, last_login_at
         FROM users WHERE id = ?`,
    )
      .bind(target.id)
      .first();
    return json({ user });
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
