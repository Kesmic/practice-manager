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

  return json({ user, ...extra }, 200, { "Set-Cookie": cookie });
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
      const { token, expiresAt } = await createChallenge(
        env,
        row.id,
        request.headers.get("User-Agent"),
      );
      const remaining = await recoveryRemaining(env, row.id);
      return json({
        user: null,
        challenge: {
          token,
          expires_at: expiresAt,
          methods: remaining > 0 ? ["totp", "recovery"] : ["totp"],
          recovery_remaining: remaining,
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

    const usingRecovery = typeof body.recovery_code === "string" && body.recovery_code.trim() !== "";

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
      return finishLogin(env, request, challenge.user_id, {
        recovery_codes_remaining: left,
        used_recovery_code: true,
      });
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
    return finishLogin(env, request, challenge.user_id);
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
