import type { Env } from "../env";
import {
  assertPasswordPolicy,
  clearedCookie,
  createSession,
  currentSession,
  decoyHash,
  idlePolicy,
  destroySession,
  hashPassword,
  pruneSessions,
  publicUser,
  requireUser,
  verifyPassword,
} from "../auth";
import { newId, nowIso, normaliseEmail, requireString } from "../db";
import {
  checkTotp,
  consumeChallenge,
  countFailure,
  createChallenge,
  isEnabled,
  loadChallenge,
  loadTotp,
  pruneChallenges,
  recoveryRemaining,
  spendRecoveryCode,
} from "../twofactor";
import {
  checkAnswers,
  deviceIsTrusted,
  hasQuestions,
  loadQuestions,
  rememberDevice,
  secretQuestionPolicy,
  trustedDevicePolicy,
} from "../second-factor-options";
import {
  HttpError,
  Router,
  badRequest,
  conflict,
  forbidden,
  json,
  readJson,
  unauthorized,
} from "../http";
import type { Role } from "../../shared/workflow";

/**
 * Creates the session and returns the signed-in user.
 *
 * Shared by the one-step and two-step paths so there is a single place where a session
 * comes into existence, and no way to reach it without having got through whichever
 * factors the account requires.
 */
async function finishLogin(
  env: Env,
  request: Request,
  userId: string,
  extra: Record<string, unknown> = {},
  extraCookies: string[] = [],
): Promise<Response> {
  await env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`)
    .bind(nowIso(), userId)
    .run();

  const { cookie } = await createSession(env, userId, request.headers.get("User-Agent"));
  const user = await env.DB.prepare(
    `SELECT id, email, full_name, role, title, status, must_change_password,
            email_notifications, created_at, last_login_at
       FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first();

  /*
   * Tuples rather than an object, because a session cookie and a remembered-device
   * cookie both go out under Set-Cookie and an object cannot hold the same key twice.
   * Two cookies folded into one header is not two cookies, so the end-to-end suite
   * asserts that both actually arrive.
   */
  const headers: Array<[string, string]> = [
    ["Set-Cookie", cookie],
    ...extraCookies.map((value) => ["Set-Cookie", value] as [string, string]),
  ];

  return json({ user, ...extra }, 200, headers);
}

export function registerAuthRoutes(router: Router<Env>): void {
  /**
   * Creates the first administrator. Refuses once any user exists, and requires
   * the BOOTSTRAP_SECRET so a public deployment cannot be claimed by a stranger
   * in the window before the first sign-up.
   */
  router.post("/api/auth/bootstrap", async ({ request, env }) => {
    const body = await readJson<{
      secret?: string;
      email?: string;
      full_name?: string;
      password?: string;
    }>(request);

    if (!env.BOOTSTRAP_SECRET) {
      throw forbidden(
        "Bootstrap is disabled because BOOTSTRAP_SECRET is not configured.",
      );
    }
    if (
      typeof body.secret !== "string" ||
      body.secret.length !== env.BOOTSTRAP_SECRET.length ||
      body.secret !== env.BOOTSTRAP_SECRET
    ) {
      throw forbidden("Bootstrap secret is incorrect.");
    }

    const existing = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users`,
    ).first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) {
      throw conflict(
        "This deployment already has users. Bootstrap can only run once.",
      );
    }

    const email = normaliseEmail(body.email);
    const fullName = requireString(body.full_name, "full_name", { max: 120 });
    const password = typeof body.password === "string" ? body.password : "";
    assertPasswordPolicy(password);

    const id = newId();
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO users (id, email, full_name, role, title, status, password_hash,
                          must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', ?, 'active', ?, 0, ?, ?)`,
    )
      .bind(
        id,
        email,
        fullName,
        "Managing Partner",
        await hashPassword(env, password),
        timestamp,
        timestamp,
      )
      .run();

    const { cookie } = await createSession(
      env,
      id,
      request.headers.get("User-Agent"),
    );
    return json({ ok: true, email }, 201, { "Set-Cookie": cookie });
  });

  router.post("/api/auth/login", async ({ request, env }) => {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      throw badRequest("Email and password are both required.");
    }

    const row = await env.DB.prepare(
      `SELECT id, password_hash, status, must_change_password
         FROM users WHERE lower(email) = ?`,
    )
      .bind(email)
      .first<{
        id: string;
        password_hash: string;
        status: string;
        must_change_password: 0 | 1;
      }>();

    const ok = await verifyPassword(
      env,
      password,
      row?.password_hash ?? decoyHash(env),
    );
    if (!row || !ok) {
      throw unauthorized("Email or password is incorrect.");
    }
    if (row.status !== "active") {
      throw forbidden("This account has been suspended. Contact your administrator.");
    }

    await pruneSessions(env);
    await pruneChallenges(env);

    /*
     * The password was right. If this account has a confirmed second factor, no session
     * is created here and no cookie is sent: what comes back is a challenge, which is
     * worth nothing on its own and expires in five minutes. Everything that follows
     * needs the code as well.
     */
    if (await isEnabled(env, row.id)) {
      /*
       * A browser that already completed the second step, and was asked to be
       * remembered, goes straight in. What it presents is not a factor: it is a note
       * that the factor was presented on this machine, bound to this account, with an
       * expiry. Losing it is no worse than losing a live session cookie, which is a risk
       * the session cookie already carries.
       */
      const devices = await trustedDevicePolicy(env);
      if (devices.enabled && (await deviceIsTrusted(env, request, row.id))) {
        return finishLogin(env, request, row.id, { remembered_device: true });
      }

      const { token, expiresAt } = await createChallenge(
        env,
        row.id,
        request.headers.get("User-Agent"),
      );
      const remaining = await recoveryRemaining(env, row.id);

      const questionsAllowed = (await secretQuestionPolicy(env)).enabled;
      const questionsSet = questionsAllowed && (await hasQuestions(env, row.id));

      const methods = ["totp"];
      if (remaining > 0) methods.push("recovery");
      if (questionsSet) methods.push("questions");

      return json({
        user: null,
        challenge: {
          token,
          expires_at: expiresAt,
          methods,
          recovery_remaining: remaining,
          // The questions themselves, because they have to be shown to be answered.
          // Nothing here helps answer them.
          questions: questionsSet
            ? (await loadQuestions(env, row.id)).map((q) => ({
                position: q.position,
                question: q.question,
              }))
            : [],
          can_remember_device: devices.enabled,
          remember_device_days: devices.enabled ? devices.days : 0,
        },
      });
    }

    return finishLogin(env, request, row.id);
  });

  /**
   * The second step: a code from the authenticator app, or a recovery code.
   *
   * Deliberately separate from the password step rather than a field on it. The browser
   * has nothing that authenticates it between the two, which is the point: a stolen
   * password gets as far as this endpoint and no further.
   */
  router.post("/api/auth/2fa", async ({ request, env }) => {
    const body = await readJson<{
      challenge?: unknown;
      code?: unknown;
      recovery_code?: unknown;
      answers?: unknown;
      remember_device?: unknown;
    }>(request);

    const challenge = await loadChallenge(env, body.challenge);
    if (!challenge) {
      throw unauthorized(
        "That sign-in has expired or was not recognised. Enter your email and password again.",
      );
    }

    /*
     * Whether this sign-in may leave a remembered device behind.
     *
     * Deliberately not offered to somebody who got in by answering their secret
     * questions. Those are the weak route, and letting them mint a thirty-day pass would
     * compound the weakness rather than contain it: one lucky guess would buy a month of
     * no second step at all. A code or a recovery code both mean something physical was
     * present, and those may be remembered.
     */
    const devicePolicy = await trustedDevicePolicy(env);
    const wantsRemember = body.remember_device === true && devicePolicy.enabled;
    const rememberCookies = async () =>
      wantsRemember && devicePolicy.enabled
        ? [
            await rememberDevice(
              env,
              challenge.user_id,
              request.headers.get("User-Agent"),
              devicePolicy.days,
            ),
          ]
        : [];

    // The secret questions, when the firm allows them and this is the route taken.
    const usingQuestions = Array.isArray(body.answers) && body.answers.length > 0;
    if (usingQuestions) {
      if (!(await secretQuestionPolicy(env)).enabled) {
        throw forbidden("This firm does not allow secret questions as a second step.");
      }
      const matched = await checkAnswers(env, challenge.user_id, body.answers);
      if (!matched) {
        const { exhausted, remaining } = await countFailure(env, challenge);
        // Which answer was wrong is deliberately not said: that would turn one guess at
        // two questions into two independent guesses at one.
        throw unauthorized(
          exhausted
            ? "Those answers are not right, and there have been too many attempts. Enter your email and password again."
            : `Those answers are not right. ${remaining} attempt(s) left.`,
        );
      }
      await consumeChallenge(env, challenge);
      return finishLogin(env, request, challenge.user_id, { used_secret_questions: true });
    }

    const usingRecovery = typeof body.recovery_code === "string" && body.recovery_code.trim() !== "";

    if (usingRecovery) {
      const spent = await spendRecoveryCode(env, challenge.user_id, body.recovery_code);
      if (!spent) {
        const { exhausted, remaining } = await countFailure(env, challenge);
        throw unauthorized(
          exhausted
            ? "That recovery code is not right, and there have been too many attempts. Enter your email and password again."
            : `That recovery code is not right, or it has already been used. ${remaining} attempt(s) left.`,
        );
      }
      await consumeChallenge(env, challenge);
      const left = await recoveryRemaining(env, challenge.user_id);
      return finishLogin(
        env,
        request,
        challenge.user_id,
        { recovery_codes_remaining: left, used_recovery_code: true, remembered_device: wantsRemember },
        await rememberCookies(),
      );
    }

    const row = await loadTotp(env, challenge.user_id);
    if (!row?.confirmed_at) {
      // The enrolment was reset between the two steps. The password already succeeded,
      // so let them in rather than stranding them at a step that no longer applies.
      await consumeChallenge(env, challenge);
      return finishLogin(env, request, challenge.user_id);
    }

    const result = await checkTotp(env, row, body.code);
    if (!result.ok) {
      const { exhausted, remaining } = await countFailure(env, challenge);
      if (result.reason === "unreadable") {
        throw unauthorized(
          "This deployment can no longer read your secret, which happens if PASSWORD_PEPPER changed. Ask a Partner to reset your two-step sign-in.",
        );
      }
      const detail =
        result.reason === "replay"
          ? "That code has already been used. Wait for the app to show the next one."
          : "That code is not right. Check your phone's clock is set automatically.";
      throw unauthorized(
        exhausted
          ? `${detail} There have been too many attempts, so enter your email and password again.`
          : `${detail} ${remaining} attempt(s) left.`,
      );
    }

    await consumeChallenge(env, challenge);
    return finishLogin(
      env,
      request,
      challenge.user_id,
      { remembered_device: wantsRemember },
      await rememberCookies(),
    );
  });

  router.post("/api/auth/logout", async ({ request, env }) => {
    await destroySession(env, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearedCookie });
  });

  router.get("/api/auth/me", async ({ request, env }) => {
    const { user, idled } = await currentSession(env, request);
    const idle = await idlePolicy(env);
    if (!user) {
      // `idled` is what lets the sign-in screen explain the absence rather than leaving
      // somebody to wonder where their afternoon went.
      return json({ user: null, idled, idle_policy: idle });
    }

    const unread = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    )
      .bind(user.id)
      .first<{ n: number }>();

    return json({
      user: publicUser(user),
      unread_notifications: unread?.n ?? 0,
      idled: false,
      idle_policy: idle,
    });
  });

  /**
   * The caller's own notification preference. Separate from /api/me/profile,
   * which writes the HR record rather than the account.
   */
  router.patch("/api/me/preferences", async ({ request, env }) => {
    const user = await requireUser(env, request);
    const body = await readJson<{ email_notifications?: unknown }>(request);
    if (typeof body.email_notifications !== "boolean") {
      throw badRequest('"email_notifications" must be true or false.');
    }
    await env.DB.prepare(
      `UPDATE users SET email_notifications = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(body.email_notifications ? 1 : 0, nowIso(), user.id)
      .run();
    return json({ email_notifications: body.email_notifications });
  });

  /** Self-service password change. Requires the current password. */
  router.post("/api/auth/password", async ({ request, env }) => {
    // Reachable while a forced password change is outstanding - that is the
    // whole point of this endpoint.
    const user = await requireUser(env, request, { allowPasswordPending: true });
    const body = await readJson<{
      current_password?: string;
      new_password?: string;
    }>(request);

    const row = await env.DB.prepare(
      `SELECT password_hash FROM users WHERE id = ?`,
    )
      .bind(user.id)
      .first<{ password_hash: string }>();
    if (!row) throw unauthorized();

    const current =
      typeof body.current_password === "string" ? body.current_password : "";
    if (!(await verifyPassword(env, current, row.password_hash))) {
      throw new HttpError(400, "Your current password is incorrect.");
    }

    const next = typeof body.new_password === "string" ? body.new_password : "";
    assertPasswordPolicy(next);
    if (next === current) {
      throw badRequest("The new password must differ from the current one.");
    }

    await env.DB.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ?
        WHERE id = ?`,
    )
      .bind(await hashPassword(env, next), nowIso(), user.id)
      .run();

    // Every other session for this user is invalidated; the caller keeps theirs.
    await env.DB.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND id != ?`,
    )
      .bind(user.id, user.session_id)
      .run();

    return json({ ok: true });
  });
}

/** Role list exposed to the client for pickers, ordered by seniority. */
export const ASSIGNABLE_ROLES: Role[] = [
  "associate",
  "senior_associate",
  "manager",
  "partner",
  "admin",
];
