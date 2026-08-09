import type { Env } from "../env";
import {
  assertPasswordPolicy,
  clearedCookie,
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  pruneSessions,
  publicUser,
  requireUser,
  verifyPassword,
} from "../auth";
import { newId, nowIso, normaliseEmail, requireString } from "../db";
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
 * A hash of a value nobody can supply, used to spend the same PBKDF2 time on
 * unknown email addresses as on known ones. Without this, response latency
 * reveals which addresses are registered.
 */
const DUMMY_HASH =
  "pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

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
        await hashPassword(password),
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

    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) {
      throw unauthorized("Email or password is incorrect.");
    }
    if (row.status !== "active") {
      throw forbidden("This account has been suspended. Contact your administrator.");
    }

    await pruneSessions(env);
    await env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`)
      .bind(nowIso(), row.id)
      .run();

    const { cookie } = await createSession(
      env,
      row.id,
      request.headers.get("User-Agent"),
    );
    const user = await env.DB.prepare(
      `SELECT id, email, full_name, role, title, status, must_change_password,
              created_at, last_login_at
         FROM users WHERE id = ?`,
    )
      .bind(row.id)
      .first();

    return json({ user }, 200, { "Set-Cookie": cookie });
  });

  router.post("/api/auth/logout", async ({ request, env }) => {
    await destroySession(env, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearedCookie });
  });

  router.get("/api/auth/me", async ({ request, env }) => {
    const user = await currentUser(env, request);
    if (!user) return json({ user: null });

    const unread = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    )
      .bind(user.id)
      .first<{ n: number }>();

    return json({ user: publicUser(user), unread_notifications: unread?.n ?? 0 });
  });

  /** Self-service password change. Requires the current password. */
  router.post("/api/auth/password", async ({ request, env }) => {
    // Reachable while a forced password change is outstanding — that is the
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
    if (!(await verifyPassword(current, row.password_hash))) {
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
      .bind(await hashPassword(next), nowIso(), user.id)
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
