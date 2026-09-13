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
import { newId, notificationStatement, nowIso, normaliseEmail, requireString } from "../db";
import {
  assertLoginAllowed,
  attemptKeys,
  clearAccountFailures,
  recordFailure,
  type AttemptKeys,
} from "../throttle";
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
  questionPrompts,
  questionsPolicy,
} from "../security-questions";
import { questionsEnabled } from "../../shared/security-questions";
import {
  clearedDeviceCookie,
  deviceIsTrusted,
  deviceTrustPolicy,
  forgetAllDevices,
  rememberDevice,
} from "../device-trust";
import { mayRememberDevice, type SecondFactorRoute } from "../../shared/device-trust";
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
  deviceCookie?: string | null,
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
    .first<{ email: string }>();

  /*
   * A completed sign-in wipes this account's failed attempts, so somebody who could not
   * remember their password is not still locked out five minutes after they remembered
   * it. Done here rather than in the login route because the two-step path only finishes
   * one request later, and until it does the sign-in has not actually happened.
   *
   * The email comes from the row rather than from what was typed: the second step never
   * sees an email address at all.
   */
  if (user?.email) {
    await clearAccountFailures(env, await attemptKeys(request, user.email));
  }

  /*
   * Two Set-Cookie headers where a device was remembered. `json()` appends rather than
   * replaces, which is what makes that possible - a single header holding both would be
   * silently ignored by every browser.
   */
  const headers = new Headers();
  headers.append("Set-Cookie", cookie);
  if (deviceCookie) headers.append("Set-Cookie", deviceCookie);

  return json({ user, ...extra }, 200, headers);
}

/**
 * Tells the account owner, and the firm's partners, that questions were used.
 *
 * A factor that can be researched should not be usable in silence. If somebody reaches
 * a partner's account by knowing where they went to school, the one thing that turns
 * that into a recoverable incident rather than an undetected one is that it left a mark
 * somebody reads.
 *
 * In the inbox rather than by email, and best-effort: a notification that fails must not
 * turn a legitimate sign-in into a failed one, so this never throws into the caller.
 */
async function announceQuestionSignIn(env: Env, userId: string): Promise<void> {
  try {
    const person = await env.DB.prepare(`SELECT full_name FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ full_name: string }>();
    if (!person) return;

    const { results: partners } = await env.DB.prepare(
      `SELECT id FROM users
        WHERE status = 'active' AND role IN ('partner','admin') AND id != ?`,
    )
      .bind(userId)
      .all<{ id: string }>();

    const when = new Date().toISOString();
    const recipients = [userId, ...partners.map((row) => row.id)];
    await env.DB.batch(
      recipients.map((recipient) =>
        notificationStatement(env, {
          userId: recipient,
          taskId: null,
          kind: "signin:security_questions",
          title:
            recipient === userId
              ? "You signed in with your security questions"
              : `${person.full_name} signed in with security questions`,
          body:
            recipient === userId
              ? `This happened at ${when}. If it was not you, change your password now and tell a Partner.`
              : `Security questions were accepted in place of an authenticator code at ${when}.`,
        }),
      ),
    );
  } catch (err) {
    console.error("Could not record a security-question sign-in:", err);
  }
}

/**
 * The questions to put to somebody at the second step, or none.
 *
 * Empty whenever the firm has the feature switched off, so turning it off takes effect
 * on the next sign-in for everybody, without touching a single enrolment. Somebody who
 * had enrolled questions keeps them, and they start working again if the firm changes
 * its mind - which is the behaviour a policy switch should have.
 */
async function offeredQuestions(
  env: Env,
  userId: string,
): Promise<Array<{ id: string; question: string }>> {
  if (!questionsEnabled(await questionsPolicy(env))) return [];
  return questionPrompts(env, userId);
}

/** Whether to offer "remember this device", and for how long. */
async function deviceTrustOffer(
  env: Env,
): Promise<{ offered: boolean; days: number }> {
  const policy = await deviceTrustPolicy(env);
  return policy.enabled
    ? { offered: true, days: policy.days }
    : { offered: false, days: 0 };
}

/**
 * The rate-limit keys for a second-step attempt.
 *
 * The challenge holds a user id and nothing else, so the account key has to be looked up.
 * Returns null when the account has vanished between the two steps, in which case the
 * attempt is unattributable and the route falls through to its own error.
 */
async function twoFactorKeys(
  env: Env,
  request: Request,
  userId: string,
): Promise<AttemptKeys | null> {
  const row = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ email: string }>();
  return row ? attemptKeys(request, row.email) : null;
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

    /*
     * The bootstrap secret is guessable in exactly the way a password is, and until the
     * first administrator exists it is the only thing standing between a stranger and an
     * admin account on a freshly deployed portal. It is counted under its own account key
     * so a run of failed bootstrap attempts cannot lock a real person out.
     */
    const keys = await attemptKeys(request, "@bootstrap");
    await assertLoginAllowed(env, keys);

    if (
      typeof body.secret !== "string" ||
      body.secret.length !== env.BOOTSTRAP_SECRET.length ||
      body.secret !== env.BOOTSTRAP_SECRET
    ) {
      await recordFailure(env, keys);
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

    /*
     * Before the hash, not after. A refused attempt should cost this Worker nothing, and
     * on the Free plan PBKDF2 is most of the request's CPU budget.
     */
    const keys = await attemptKeys(request, email);
    await assertLoginAllowed(env, keys);

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
      // Counted whether or not the address belongs to anybody. Counting only real
      // accounts would make the limit itself the tell for which addresses exist.
      await recordFailure(env, keys);
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
       * A browser this person has previously vouched for skips the second step - and
       * only the second step. The password above still had to be right, which is what
       * keeps a stolen laptop from being a stolen account.
       */
      if (await deviceIsTrusted(env, request, row.id)) {
        return finishLogin(env, request, row.id, { device_remembered: true });
      }

      const { token, expiresAt } = await createChallenge(
        env,
        row.id,
        request.headers.get("User-Agent"),
      );
      const [remaining, questions] = await Promise.all([
        recoveryRemaining(env, row.id),
        offeredQuestions(env, row.id),
      ]);

      /*
       * The app is the way in. Everything else is a way back in.
       *
       * Split into two lists rather than one, because the difference is the whole point:
       * a code proves possession of the phone, while a recovery code and a set of
       * security questions are what somebody falls back on when they cannot produce one.
       * Presenting all three as peers would invite the weakest to become the habit.
       */
      const recoveryMethods: string[] = [];
      if (questions.length) recoveryMethods.push("questions");
      if (remaining > 0) recoveryMethods.push("recovery");

      return json({
        user: null,
        challenge: {
          token,
          expires_at: expiresAt,
          methods: ["totp"],
          recovery_methods: recoveryMethods,
          recovery_remaining: remaining,
          // Sent with the challenge rather than fetched separately: an endpoint that
          // handed out somebody's questions for an email address alone would be a way to
          // learn things about them without ever knowing their password.
          questions,
          device_trust: await deviceTrustOffer(env),
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
     * The second step counts against the same limit as the first.
     *
     * A challenge already caps itself at five codes, but nothing stops an attacker who
     * holds the password from starting a fresh challenge for each guess - and six digits
     * is a million codes, not enough to be safe against unlimited tries. Counting these
     * here is what makes the per-challenge cap mean something.
     */
    const keys = await twoFactorKeys(env, request, challenge.user_id);
    if (keys) await assertLoginAllowed(env, keys);

    /*
     * Whether to remember this browser.
     *
     * Honoured only on the authenticator-app path. A device is remembered on the
     * strength of the factor that vouched for it, and only a code from the app is strong
     * enough to be worth thirty days. The two recovery paths below ignore this and say so
     * in their response, so the screen can tell somebody their tick did not take effect
     * rather than leaving them to assume it did.
     */
    const wantsRemembered = body.remember_device === true;
    const remember = async (route: SecondFactorRoute) =>
      wantsRemembered && mayRememberDevice(route)
        ? rememberDevice(env, request, challenge.user_id)
        : null;

    const usingQuestions =
      typeof body.answers === "object" && body.answers !== null && !Array.isArray(body.answers);
    const usingRecovery = typeof body.recovery_code === "string" && body.recovery_code.trim() !== "";

    if (usingQuestions) {
      // Checked here as well as when the challenge was issued: the firm may have turned
      // questions off in the five minutes since, and the answer to "may this be used"
      // has to be the policy as it stands now.
      if (!questionsEnabled(await questionsPolicy(env))) {
        throw forbidden(
          "This firm does not accept security questions as a way back in. Use the code from your authenticator app.",
        );
      }

      const result = await checkAnswers(env, challenge.user_id, body.answers);
      if (!result.ok) {
        if (keys) await recordFailure(env, keys);
        const { exhausted, remaining } = await countFailure(env, challenge);

        if (result.reason === "unreadable") {
          throw unauthorized(
            "This deployment can no longer read your saved answers, which happens if PASSWORD_PEPPER changed. Ask a Partner to reset your two-step sign-in.",
          );
        }
        if (result.reason === "none_enrolled") {
          throw unauthorized(
            "There are no security questions saved for this account. Use the code from your authenticator app.",
          );
        }
        /*
         * One message for a wrong answer and for a missing one, and it never says which
         * question was wrong. Reporting "two of three correct" would turn a set of
         * questions into three separate one-question guesses, which is the weakness that
         * makes asking a subset worthless.
         */
        const detail =
          "Those answers do not match. Answer every question, spelling them as you did when you saved them.";
        throw unauthorized(
          exhausted
            ? `${detail} There have been too many attempts, so enter your email and password again.`
            : `${detail} ${remaining} attempt(s) left.`,
        );
      }

      await consumeChallenge(env, challenge);
      await announceQuestionSignIn(env, challenge.user_id);
      /*
       * No remembered device on this path, whatever was ticked.
       *
       * Security questions are a way back in, not a way in, and the answers are
       * reusable facts rather than a single-use secret. Letting them mint thirty days of
       * skipping the second step would turn one afternoon's research into a month of
       * unchallenged access - and would quietly make the weakest factor the one that
       * decides how often the strongest is asked for.
       */
      return finishLogin(
        env,
        request,
        challenge.user_id,
        {
          used_security_questions: true,
          device_not_remembered: wantsRemembered,
        },
        await remember("questions"),
      );
    }

    if (usingRecovery) {
      const spent = await spendRecoveryCode(env, challenge.user_id, body.recovery_code);
      if (!spent) {
        if (keys) await recordFailure(env, keys);
        const { exhausted, remaining } = await countFailure(env, challenge);
        throw unauthorized(
          exhausted
            ? "That recovery code is not right, and there have been too many attempts. Enter your email and password again."
            : `That recovery code is not right, or it has already been used. ${remaining} attempt(s) left.`,
        );
      }
      await consumeChallenge(env, challenge);
      const left = await recoveryRemaining(env, challenge.user_id);
      // A recovery code is spent getting back in; it does not also buy a month of not
      // being asked. Same reasoning as the questions path above.
      return finishLogin(
        env,
        request,
        challenge.user_id,
        {
          recovery_codes_remaining: left,
          used_recovery_code: true,
          device_not_remembered: wantsRemembered,
        },
        await remember("recovery"),
      );
    }

    const row = await loadTotp(env, challenge.user_id);
    if (!row?.confirmed_at) {
      // The enrolment was reset between the two steps. The password already succeeded,
      // so let them in rather than stranding them at a step that no longer applies.
      await consumeChallenge(env, challenge);
      return finishLogin(env, request, challenge.user_id, {}, await remember("totp"));
    }

    const result = await checkTotp(env, row, body.code);
    if (!result.ok) {
      if (keys) await recordFailure(env, keys);
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
    return finishLogin(env, request, challenge.user_id, {}, await remember("totp"));
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

    /*
     * And every remembered device, including this one.
     *
     * Somebody changing their password is either doing housekeeping or responding to
     * having lost control of the account, and the system cannot tell which. A device
     * that kept its right to skip the second step across a password change would
     * survive precisely the action taken to end an intrusion. The cost is one extra
     * code on each of their own machines, once.
     */
    await forgetAllDevices(env, user.id);

    return json({ ok: true }, 200, { "Set-Cookie": clearedDeviceCookie });
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
