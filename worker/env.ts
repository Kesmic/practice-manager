export interface Env {
  /** D1 binding declared in wrangler.toml. */
  DB: D1Database;
  /** Static asset binding - serves the built React app. */
  ASSETS: Fetcher;
  /**
   * Object storage for the two documents a member of staff attaches to their own
   * record. Declared optional so the Worker starts on a deployment where the bucket
   * has not been created yet - the upload endpoints say so plainly instead of the
   * whole portal failing to boot over a feature most of it does not use.
   */
  FILES?: R2Bucket;
  /**
   * One-time secret that authorises creation of the very first administrator.
   * Set with `wrangler secret put BOOTSTRAP_SECRET`. The bootstrap endpoint
   * refuses to run once any user exists, so this cannot be replayed.
   */
  BOOTSTRAP_SECRET?: string;
  /**
   * Authorises the nightly invoice-reminder run.
   *
   * This is a Cloudflare Pages project, which has no cron triggers of its own, so the
   * schedule lives in a GitHub Actions workflow that calls the endpoint once a day with
   * this value. Unset means nobody may run it, never that anybody may.
   */
  REMINDER_SECRET?: string;
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

  /**
   * Email notifications. All optional: with no EMAIL_API_KEY the portal sends
   * nothing and behaves exactly as it does today, with the in-app inbox as the
   * only channel. See docs/EMAIL.md.
   */
  EMAIL_API_KEY?: string;
  /** The From address, e.g. "Kesmic Practice Manager <portal@kesmic.org>". */
  EMAIL_FROM?: string;
  /**
   * Which service delivers the mail: "resend", "postmark" or "sendgrid".
   * Defaults to Resend.
   *
   * This exists because the choice is forced by DNS rather than by preference.
   * Resend verifies a domain by asking for an MX record on a subdomain, and some
   * registrars, Wix among them, will not create one. Postmark and SendGrid verify
   * with TXT and CNAME records only, which every registrar supports. All three
   * take the same three settings, so switching is a variable rather than a change
   * to the code.
   */
  EMAIL_PROVIDER?: string;
  /**
   * Base address used for links in emails, e.g. https://portal.kesmic.org. Left
   * unset, links use the origin the portal was reached on, which is right unless
   * it answers to more than one name.
   */
  PORTAL_URL?: string;
}
