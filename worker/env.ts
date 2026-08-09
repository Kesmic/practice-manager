export interface Env {
  /** D1 binding declared in wrangler.toml. */
  DB: D1Database;
  /** Static asset binding — serves the built React app. */
  ASSETS: Fetcher;
  /**
   * One-time secret that authorises creation of the very first administrator.
   * Set with `wrangler secret put BOOTSTRAP_SECRET`. The bootstrap endpoint
   * refuses to run once any user exists, so this cannot be replayed.
   */
  BOOTSTRAP_SECRET?: string;
  /** Session lifetime in days. Defaults to 7. */
  SESSION_TTL_DAYS?: string;
}
