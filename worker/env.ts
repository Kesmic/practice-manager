export interface Env {
  /** D1 binding declared in wrangler.toml. */
  DB: D1Database;
  /** Static asset binding - serves the built React app. */
  ASSETS: Fetcher;
  /**
   * One-time secret that authorises creation of the very first administrator.
   * Set with `wrangler secret put BOOTSTRAP_SECRET`. The bootstrap endpoint
   * refuses to run once any user exists, so this cannot be replayed.
   */
  BOOTSTRAP_SECRET?: string;
  /** Session lifetime in days. Defaults to 7. */
  SESSION_TTL_DAYS?: string;
  /**
   * PBKDF2 work factor for password hashing. Left unset it defaults to a value
   * that fits the 10 ms CPU budget of the Workers Free plan; raise it on the
   * Paid plan. See the notes in `auth.ts` - the ceiling here is the CPU limit,
   * not cryptography.
   */
  PASSWORD_ITERATIONS?: string;
  /**
   * Optional secret mixed into every password before hashing. Because it lives
   * in Worker secrets rather than in D1, a leaked database export cannot be
   * attacked offline at all. Safe to add later; must never be changed or
   * removed afterwards, or existing passwords stop verifying.
   */
  PASSWORD_PEPPER?: string;
}
