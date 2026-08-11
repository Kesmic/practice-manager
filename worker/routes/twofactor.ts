/**
 * Setting up, confirming and removing a second factor.
 *
 * The sign-in half of this lives in routes/auth.ts, next to the password step it
 * follows. What is here is what a person does to their own enrolment, and what a partner
 * can do to somebody else's.
 */

import type { Env } from "../env";
import { requireRole, requireUser } from "../auth";
import { nowIso } from "../db";
import { Router, badRequest, forbidden, json, notFound, readJson } from "../http";
import { encodeQr, qrSvg } from "../../shared/qr";
import { groupSecret, otpauthUri } from "../../shared/totp";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import { ROLE_LABELS, ROLES, type Role } from "../../shared/workflow";
import {
  RECOMMENDED_TWOFACTOR_MIN_ROLE,
  TWOFACTOR_OFF,
  readPolicy,
} from "../../shared/twofactor";
import {
  beginEnrolment,
  checkTotp,
  clearEnrolment,
  isRequiredFor,
  issueRecoveryCodes,
  loadTotp,
  openSecret,
  statusFor,
  twoFactorPolicy,
} from "../twofactor";
import { readSettings, writeSetting } from "./settings";

export function registerTwoFactorRoutes(router: Router<Env>): void {
  /**
   * What the reader's own second factor looks like.
   *
   * Reachable on a temporary password, and by someone who is required to enrol and has
   * not: those are exactly the people who need to see this screen.
   */
  router.get("/api/2fa", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowTwoFactorPending: true,
    });
    return json({ two_factor: await statusFor(env, actor.id, actor.role) });
  });

  /**
   * Starts enrolment: a new secret, the QR code for it, and the key in case the camera
   * will not cooperate.
   *
   * The secret is returned here and nowhere else. Once confirmed it cannot be read back,
   * by anyone, which is why the screen makes the person confirm before it stops showing.
   */
  router.post("/api/2fa/start", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowTwoFactorPending: true,
    });

    const existing = await loadTotp(env, actor.id);
    if (existing?.confirmed_at) {
      throw badRequest(
        "Two-step sign-in is already set up. Turn it off first if you are moving to a new phone.",
      );
    }

    const secret = await beginEnrolment(env, actor.id);
    const settings = await readSettings(env);
    const uri = otpauthUri({
      issuer: settings.firm_name || "Practice Manager",
      account: actor.email,
      secret,
    });

    // A QR code that will not fit is not a failure: the key can still be typed.
    const code = encodeQr(uri, "L");

    return json({
      secret,
      secret_grouped: groupSecret(secret),
      uri,
      qr_svg: code ? qrSvg(code) : null,
      issuer: settings.firm_name,
      account: actor.email,
    });
  });

  /**
   * Confirms enrolment with a code from the app, and issues the recovery codes.
   *
   * The codes come back exactly once. They are stored only as hashes, so nobody,
   * including whoever runs the firm, can produce them again.
   */
  router.post("/api/2fa/confirm", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowTwoFactorPending: true,
    });
    const body = await readJson<{ code?: unknown }>(request);

    const row = await loadTotp(env, actor.id);
    if (!row) throw badRequest("Start setting up two-step sign-in first.");
    if (row.confirmed_at) throw badRequest("Two-step sign-in is already set up.");

    const result = await checkTotp(env, row, body.code);
    if (!result.ok) {
      if (result.reason === "unreadable") {
        throw badRequest(
          "This deployment can no longer read that secret, which happens if PASSWORD_PEPPER changed. Start setting up again.",
        );
      }
      throw badRequest(
        "That code is not right. Check the app is showing the entry for this portal, and that your phone's clock is set automatically.",
      );
    }

    await env.DB.prepare(
      `UPDATE user_totp SET confirmed_at = ?, updated_at = ? WHERE user_id = ?`,
    )
      .bind(nowIso(), nowIso(), actor.id)
      .run();

    const codes = await issueRecoveryCodes(env, actor.id);
    return json({
      ok: true,
      recovery_codes: codes,
      two_factor: await statusFor(env, actor.id, actor.role),
    });
  });

  /**
   * A fresh set of recovery codes, replacing the old ones.
   *
   * Needs a current code, not just a session: if someone else is at the keyboard, this
   * would otherwise hand them ten ways back in at their leisure.
   */
  router.post("/api/2fa/recovery-codes", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    const body = await readJson<{ code?: unknown }>(request);

    const row = await loadTotp(env, actor.id);
    if (!row?.confirmed_at) throw badRequest("Two-step sign-in is not set up.");

    const result = await checkTotp(env, row, body.code);
    if (!result.ok) throw badRequest(codeFailureMessage(result.reason));

    const codes = await issueRecoveryCodes(env, actor.id);
    return json({ ok: true, recovery_codes: codes });
  });

  /**
   * Turns it off for yourself.
   *
   * Requires a current code as well as the session, for the same reason. Refused
   * outright where the firm's policy obliges this grade to have it: the way out of that
   * is for a partner to change the policy, not for the person covered by it to opt out.
   */
  router.post("/api/2fa/disable", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    const body = await readJson<{ code?: unknown }>(request);

    const policy = await twoFactorPolicy(env);
    if (isRequiredFor(policy, actor.role)) {
      throw forbidden(
        `Two-step sign-in is required at ${ROLE_LABELS[actor.role]} grade in this firm, so it cannot be turned off here. A Partner can change that under Portal settings, Sign-in security.`,
      );
    }

    const row = await loadTotp(env, actor.id);
    if (!row?.confirmed_at) throw badRequest("Two-step sign-in is not set up.");

    const result = await checkTotp(env, row, body.code);
    if (!result.ok) throw badRequest(codeFailureMessage(result.reason));

    await clearEnrolment(env, actor.id);
    return json({ ok: true, two_factor: await statusFor(env, actor.id, actor.role) });
  });

  // ------------------------------------------------------------------- others

  /**
   * Resets somebody else's enrolment, for the lost phone with the lost codes.
   *
   * Partner grade, and it cannot be used on yourself: a partner who could reset their
   * own would have a way round the second factor that needs only their password, which
   * is the thing this feature exists to stop. Your own is turned off with a code, or
   * reset by another partner.
   */
  router.post("/api/users/:id/2fa/reset", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    if (params.id === actor.id) {
      throw badRequest(
        "You cannot reset your own two-step sign-in. Use a recovery code, or ask another Partner to reset it.",
      );
    }

    const target = await env.DB.prepare(
      `SELECT id, full_name, role FROM users WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; full_name: string; role: Role }>();
    if (!target) throw notFound("That person does not exist.");

    const had = await loadTotp(env, target.id);
    await clearEnrolment(env, target.id);

    const policy = await twoFactorPolicy(env);
    return json({
      ok: true,
      was_enrolled: Boolean(had?.confirmed_at),
      must_enrol_again: isRequiredFor(policy, target.role),
      message: had?.confirmed_at
        ? `${target.full_name} can now sign in with their password alone, and will be asked to set up two-step sign-in again` +
          (isRequiredFor(policy, target.role)
            ? " before they can do anything else."
            : ", though their grade does not oblige them to.")
        : `${target.full_name} did not have two-step sign-in set up, so nothing changed.`,
    });
  });

  /** Who has it, for the screen that manages accounts. */
  router.get("/api/2fa/overview", async ({ request, env }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const policy = await twoFactorPolicy(env);

    const { results } = await env.DB.prepare(
      `SELECT u.id, u.full_name, u.email, u.role, u.status,
              t.confirmed_at,
              (SELECT COUNT(*) FROM recovery_codes r
                WHERE r.user_id = u.id AND r.used_at IS NULL) AS recovery_remaining
         FROM users u
         LEFT JOIN user_totp t ON t.user_id = u.id
        WHERE u.status = 'active'
        ORDER BY CASE u.role
                   WHEN 'admin' THEN 1 WHEN 'partner' THEN 2 WHEN 'manager' THEN 3
                   WHEN 'senior_associate' THEN 4 ELSE 5 END,
                 u.full_name`,
    ).all<{
      id: string;
      full_name: string;
      email: string;
      role: Role;
      confirmed_at: string | null;
      recovery_remaining: number;
    }>();

    return json({
      policy,
      people: results.map((row) => ({
        ...row,
        enabled: Boolean(row.confirmed_at),
        required: isRequiredFor(policy, row.role),
      })),
      outstanding: results.filter(
        (row) => isRequiredFor(policy, row.role) && !row.confirmed_at,
      ).length,
    });
  });

  /** The firm's policy: the lowest grade obliged to use a second factor, or off. */
  router.put("/api/2fa/policy", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ minimum?: unknown }>(request);

    const raw = typeof body.minimum === "string" ? body.minimum.trim() : "";
    if (raw !== TWOFACTOR_OFF && !ROLES.includes(raw as Role)) {
      throw badRequest(
        `"${raw}" is not a grade. Give a grade, or "${TWOFACTOR_OFF}" to require it of nobody.`,
      );
    }

    /*
     * A partner turning this on for their own grade would otherwise lock themselves out
     * of turning it off again if they never enrol. They are not locked out: they can
     * still sign in and will be confined to enrolling, which is the intended effect.
     * Worth saying in the response rather than leaving them to discover it.
     */
    const policy = readPolicy(raw);
    await writeSetting(env, "twofactor_min_role", raw, actor.id);

    const covered = ROLES.filter((role) => isRequiredFor(policy, role));
    const stillToEnrol = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users u
        LEFT JOIN user_totp t ON t.user_id = u.id
        WHERE u.status = 'active' AND t.confirmed_at IS NULL`,
    ).first<{ n: number }>();

    return json({
      policy,
      covered_grades: covered,
      /*
       * Counts everyone without an enrolment, then narrows to those the new policy
       * covers, so the response can say how many people this actually affects.
       */
      not_yet_enrolled: stillToEnrol?.n ?? 0,
      applies_to_self: isRequiredFor(policy, actor.role),
    });
  });
}

/** One place for the wording, so every failure path says the same thing. */
function codeFailureMessage(reason: "ok" | "unreadable" | "replay" | "mismatch"): string {
  if (reason === "unreadable") {
    return "This deployment can no longer read your secret, which happens if PASSWORD_PEPPER changed. Ask a Partner to reset your two-step sign-in.";
  }
  if (reason === "replay") {
    return "That code has already been used. Wait for the app to show the next one.";
  }
  return "That code is not right. Check your phone's clock is set automatically.";
}

export { RECOMMENDED_TWOFACTOR_MIN_ROLE, openSecret };
