/**
 * Setting up, confirming and removing a second factor.
 *
 * The sign-in half of this lives in routes/auth.ts, next to the password step it
 * follows. What is here is what a person does to their own enrolment, and what a partner
 * can do to somebody else's.
 */

import type { Env } from "../env";
import { idlePolicy, requireRole, requireUser } from "../auth";
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
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  SECURITY_QUESTIONS_OFF,
  SECURITY_QUESTIONS_ON,
  SUGGESTED_QUESTIONS,
  questionsEnabled,
  readQuestionsPolicy,
} from "../../shared/security-questions";
import {
  DEVICE_TRUST_OFF,
  MAX_TRUST_DAYS,
  MIN_TRUST_DAYS,
  clampTrustDays,
  writeDeviceTrustPolicy,
} from "../../shared/device-trust";
import {
  clearQuestions,
  questionPrompts,
  questionsPolicy,
  questionsScheme,
  replaceQuestions,
} from "../security-questions";
import {
  clearedDeviceCookie,
  deviceTrustPolicy,
  forgetAllDevices,
  forgetDevice,
  listDevices,
} from "../device-trust";
import {
  IDLE_OFF,
  MAX_IDLE_MINUTES,
  MIN_IDLE_MINUTES,
  clampIdleMinutes,
  writeIdlePolicy,
} from "../../shared/session-policy";
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

    const [questions, trust, withQuestions, remembered] = await Promise.all([
      questionsPolicy(env),
      deviceTrustPolicy(env),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT user_id) AS n FROM user_security_questions`,
      ).first<{ n: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM trusted_devices WHERE expires_at > ?`,
      )
        .bind(nowIso())
        .first<{ n: number }>(),
    ]);

    return json({
      policy,
      idle: await idlePolicy(env),
      security_questions: {
        enabled: questionsEnabled(questions),
        people_with_questions: withQuestions?.n ?? 0,
      },
      device_trust: { policy: trust, devices_remembered: remembered?.n ?? 0 },
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

  /**
   * Signing people out after a spell of inactivity.
   *
   * Lives beside the two-factor policy because it is the same screen and the same
   * question: how much the firm wants between an unattended desk and its client files.
   */
  router.put("/api/session-policy", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ idle_minutes?: unknown; enabled?: unknown }>(request);

    if (body.enabled === false) {
      await writeSetting(env, "idle_timeout_minutes", IDLE_OFF, actor.id);
      return json({ idle: { enabled: false } });
    }

    const raw = body.idle_minutes;
    const minutes = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(minutes)) {
      throw badRequest("Give a number of minutes, or enabled: false to switch it off.");
    }
    if (minutes < MIN_IDLE_MINUTES || minutes > MAX_IDLE_MINUTES) {
      throw badRequest(
        `The inactivity period has to be between ${MIN_IDLE_MINUTES} and ${MAX_IDLE_MINUTES} minutes.`,
      );
    }

    const policy = { enabled: true as const, minutes: clampIdleMinutes(minutes) };
    await writeSetting(env, "idle_timeout_minutes", writeIdlePolicy(policy), actor.id);
    return json({ idle: policy });
  });

  // -------------------------------------------------------- security questions

  /**
   * The reader's own questions, and what the firm allows.
   *
   * The answers never come back, from here or anywhere. There is no endpoint that reads
   * one: an answer that could be read back would be a password the firm keeps in clear.
   */
  router.get("/api/2fa/questions", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowTwoFactorPending: true,
    });
    const [policy, questions] = await Promise.all([
      questionsPolicy(env),
      questionPrompts(env, actor.id),
    ]);
    return json({
      allowed: questionsEnabled(policy),
      questions,
      suggested: SUGGESTED_QUESTIONS,
      min: MIN_QUESTIONS,
      max: MAX_QUESTIONS,
      answers_keyed: questionsScheme(env) === "hmac",
    });
  });

  /**
   * Saves a set of questions and answers, replacing any that exist.
   *
   * Requires a current code from the authenticator app. Without that, somebody who found
   * an unattended signed-in screen could add three questions of their own choosing and
   * walk back in tomorrow with the password - turning a second factor into a back door
   * rather than adding one.
   */
  router.put("/api/2fa/questions", async ({ request, env }) => {
    const actor = await requireUser(env, request, { allowPasswordPending: true });
    const body = await readJson<{ entries?: unknown; code?: unknown }>(request);

    if (!questionsEnabled(await questionsPolicy(env))) {
      throw forbidden(
        "This firm does not use security questions. A Partner can turn them on under Portal settings, Sign-in security.",
      );
    }

    const row = await loadTotp(env, actor.id);
    if (!row?.confirmed_at) {
      throw badRequest(
        "Set up the authenticator app first. Security questions stand in for a code, so there has to be a code to stand in for.",
      );
    }
    const check = await checkTotp(env, row, body.code);
    if (!check.ok) throw badRequest(codeFailureMessage(check.reason));

    if (!Array.isArray(body.entries)) {
      throw badRequest('"entries" must be a list of questions and answers.');
    }
    const entries = body.entries.map((entry) => ({
      question: String((entry as { question?: unknown })?.question ?? ""),
      answer: String((entry as { answer?: unknown })?.answer ?? ""),
    }));

    const { problem } = await replaceQuestions(env, actor.id, entries);
    if (problem) throw badRequest(problem);

    /*
     * Changing which questions guard the account changes what the account is worth to
     * somebody who knows the answers, so the devices vouched for under the old set stop
     * being vouched for.
     */
    await forgetAllDevices(env, actor.id);

    return json({
      ok: true,
      questions: await questionPrompts(env, actor.id),
      two_factor: await statusFor(env, actor.id, actor.role),
    }, 200, { "Set-Cookie": clearedDeviceCookie });
  });

  /** Removes them. No code needed: this only ever takes a way in away. */
  router.delete("/api/2fa/questions", async ({ request, env }) => {
    const actor = await requireUser(env, request, { allowPasswordPending: true });
    await clearQuestions(env, actor.id);
    return json({ ok: true, two_factor: await statusFor(env, actor.id, actor.role) });
  });

  // --------------------------------------------------------- remembered devices

  /** The browsers this person has told the portal to remember. */
  router.get("/api/2fa/devices", async ({ request, env }) => {
    const actor = await requireUser(env, request, { allowPasswordPending: true });
    const [policy, devices] = await Promise.all([
      deviceTrustPolicy(env),
      listDevices(env, request, actor.id),
    ]);
    return json({ policy, devices });
  });

  /**
   * Forgets one, by the id shown on the account screen.
   *
   * Scoped to the caller's own devices in the query itself, so an id copied from
   * somebody else's screen finds nothing rather than forgetting their machine.
   */
  router.delete("/api/2fa/devices/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request, { allowPasswordPending: true });
    const forgotten = await forgetDevice(env, actor.id, params.id);
    if (!forgotten) throw notFound("That device is not on your list.");
    return json({ ok: true, devices: await listDevices(env, request, actor.id) });
  });

  /** Forgets all of them, including the browser this was asked from. */
  router.post("/api/2fa/devices/forget-all", async ({ request, env }) => {
    const actor = await requireUser(env, request, { allowPasswordPending: true });
    await forgetAllDevices(env, actor.id);
    return json({ ok: true, devices: [] }, 200, { "Set-Cookie": clearedDeviceCookie });
  });

  /**
   * The firm's policy on security questions.
   *
   * A weakening, so the response says so plainly rather than answering "ok". Whoever
   * turns this on should see, in the same breath, what they have decided.
   */
  router.put("/api/2fa/questions-policy", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ enabled?: unknown }>(request);
    if (typeof body.enabled !== "boolean") {
      throw badRequest('"enabled" must be true or false.');
    }

    const value = body.enabled ? SECURITY_QUESTIONS_ON : SECURITY_QUESTIONS_OFF;
    await writeSetting(env, "security_questions", value, actor.id);

    const enrolled = await env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) AS n FROM user_security_questions`,
    ).first<{ n: number }>();

    return json({
      policy: readQuestionsPolicy(value),
      enabled: body.enabled,
      people_with_questions: enrolled?.n ?? 0,
      /*
       * Turning it off leaves saved answers in place rather than deleting them, so a
       * firm that switches it off to think about it does not destroy everyone's
       * enrolment on the way. Nothing accepts them while it is off.
       */
      note: body.enabled
        ? "Security questions are weaker than an authenticator code: the answers can often be researched or guessed by a colleague. Anyone signing in this way is announced in the inbox of every Partner."
        : "Saved answers are kept but will not be accepted. Nobody can sign in with questions while this is off.",
    });
  });

  /** How long a remembered device may skip the second step, or not at all. */
  router.put("/api/device-trust", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ days?: unknown; enabled?: unknown }>(request);

    if (body.enabled === false) {
      await writeSetting(env, "trusted_device_days", DEVICE_TRUST_OFF, actor.id);
      /*
       * Switching this off drops every device already remembered. Leaving them would
       * mean the setting said "off" while people carried on skipping the second step
       * for another month, which is the setting failing to mean anything.
       */
      await env.DB.prepare(`DELETE FROM trusted_devices`).run();
      return json({ policy: { enabled: false }, devices_forgotten: true });
    }

    const raw = body.days;
    const days = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(days)) {
      throw badRequest("Give a number of days, or enabled: false to switch it off.");
    }
    if (days < MIN_TRUST_DAYS || days > MAX_TRUST_DAYS) {
      throw badRequest(
        `A device can be remembered for between ${MIN_TRUST_DAYS} and ${MAX_TRUST_DAYS} days.`,
      );
    }

    const policy = { enabled: true as const, days: clampTrustDays(days) };
    await writeSetting(env, "trusted_device_days", writeDeviceTrustPolicy(policy), actor.id);
    /*
     * Applies to devices remembered from now on. Shortening the period does not reach
     * back and expire one already granted a longer run, which is worth saying rather
     * than leaving a partner to assume it did.
     */
    return json({ policy, applies_to: "devices remembered from now on" });
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
