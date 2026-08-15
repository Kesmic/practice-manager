/** Firm-wide settings: identity and the Managing Director's welcome message. */

import type { Env } from "../env";
import { requireRole, requireUser } from "../auth";
import { nowIso, optionalString } from "../db";
import { Router, badRequest, forbidden, json, readJson } from "../http";
import { ROLES, ROLE_LABELS, ROLE_RANK, type Role } from "../../shared/workflow";
import {
  AREAS,
  AREA_SPECS,
  DEFAULT_VISIBILITY,
  type Area,
  type Visibility,
  canSeeArea,
  readVisibility,
  writeVisibility,
} from "../../shared/visibility";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import { emailDiagnosis, sendTestEmail } from "../email";

/** The settings the portal reads, with the defaults used before they are set. */
const DEFAULTS: Record<string, string> = {
  firm_name: "Kesmic Consulting",
  firm_website: "https://www.kesmic.org",
  md_name: "",
  md_title: "Managing Director",
  welcome_message: "",
  /* Appearance. Empty means "use the built-in default". */
  logo_data_url: "",
  /**
   * A second version of the logo, drawn in light ink for the two navy surfaces
   * (the sidebar and the sign-in panel). Empty means "there is only one logo",
   * and the portal falls back to setting the main one on a bright plate.
   */
  logo_dark_data_url: "",
  primary_color: "",
  secondary_color: "",
  /**
   * The unguessable part of the two client intake links. Empty until the links are
   * created. Held here rather than in their own table because they are exactly what
   * settings are: one firm-wide value each, replaced rather than accumulated.
   *
   * Not editable through /api/settings and not public: they are issued and rotated
   * through /api/intake-links, which is the only place that should be able to
   * change an address the firm has already given out.
   */
  intake_token_new: "",
  intake_token_existing: "",
  /**
   * The service list on the public intake forms, as JSON: [{key, label}, ...].
   * Empty means "use the firm's service lines", which is what a new deployment
   * gets. Edited through /api/intake-services rather than here, because the
   * validation is specific and a malformed list breaks a public page.
   */
  intake_services: "",
  /**
   * Which grades can see which areas, as JSON: {"reports":"senior_associate", ...}.
   * Empty means the built-in defaults. Only what differs from the defaults is stored.
   *
   * Edited through /api/visibility rather than here, because it is enforced by the
   * Worker and a malformed value must fail closed rather than be written.
   */
  nav_visibility: "",
  /**
   * Minutes of inactivity before a session ends, or "off". Empty means the default.
   *
   * Its own endpoint rather than /api/settings, because it is enforced by the Worker on
   * every authenticated request and a malformed value would either lock the firm out or
   * quietly stop protecting them.
   */
  idle_timeout_minutes: "",
};

/** Everything except the settings that have their own, validating endpoints. */
const EDITABLE = Object.keys(DEFAULTS).filter(
  (key) =>
    !key.startsWith("intake_") &&
    key !== "nav_visibility" &&
    key !== "idle_timeout_minutes",
);

/**
 * The subset of settings that describe how the portal looks. These are readable
 * without signing in, so the firm's logo and colours appear on the sign-in screen
 * itself. None of it is confidential - it is what every visitor would see anyway.
 */
const PUBLIC_KEYS = [
  "firm_name",
  "logo_data_url",
  "logo_dark_data_url",
  "primary_color",
  "secondary_color",
];

/** Longest value each setting may hold. */
const MAX_LENGTH: Record<string, number> = {
  welcome_message: 20_000,
  // A data URI for the logo. 400,000 characters is roughly a 290 kB image, which
  // is generous for a logo and comfortably inside what a D1 row will hold.
  logo_data_url: 400_000,
  logo_dark_data_url: 400_000,
};

/** Image types a browser will render from a data URI without any conversion. */
const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif"];

function assertLogo(value: string): string {
  if (value === "") return "";
  const match = /^data:([a-z+/-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) {
    throw badRequest(
      "The logo must be an image file. Choose a PNG, JPEG, SVG or WebP.",
    );
  }
  if (!LOGO_TYPES.includes(match[1])) {
    throw badRequest(`${match[1]} is not a supported image type. Use PNG, JPEG, SVG or WebP.`);
  }
  return value;
}

function assertColour(value: string, field: string): string {
  if (value === "") return "";
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw badRequest(`"${field}" must be a colour in the form #1a2b3c.`);
  }
  return value.toLowerCase();
}

/**
 * Drops the intake tokens on the way out.
 *
 * They are part of two addresses the firm gives to outsiders, so they belong on the
 * screen that issues and rotates them, not in the settings blob every screen loads.
 */
function withoutTokens(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith("intake_token")) out[key] = value;
  }
  return out;
}

export async function readSettings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings`,
  ).all<{ key: string; value: string }>();
  const out = { ...DEFAULTS };
  for (const row of results) {
    if (row.key in out) out[row.key] = row.value;
  }
  return out;
}

/**
 * The configured visibility map, or the defaults.
 *
 * Read on the request rather than cached: a settings row is one indexed lookup, and a
 * permission that takes effect only after a redeploy is not a permission anyone can
 * rely on.
 */
export async function readVisibilitySetting(env: Env): Promise<Visibility> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("nav_visibility")
    .first<{ value: string }>();
  return readVisibility(row?.value);
}

/**
 * Requires that the caller's grade has been granted an area.
 *
 * This is the half that makes the setting real. Hiding a sidebar link while the
 * endpoint behind it still answers would be a decoration, not a permission.
 */
export async function requireArea(
  env: Env,
  request: Request,
  area: Area,
): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const actor = await requireUser(env, request);
  const visibility = await readVisibilitySetting(env);
  if (!canSeeArea(visibility, area, actor.role)) {
    throw forbidden(
      `${AREA_SPECS[area].label} is not open to ${ROLE_LABELS[actor.role]} grade in this firm. ` +
        `A Partner can change that under Portal settings, Who sees what.`,
    );
  }
  return actor;
}

export function registerSettingsRoutes(router: Router<Env>): void {
  /**
   * Who sees what. Readable by any signed-in user, because the sidebar needs it to
   * decide what to draw, and it describes their own access rather than anyone else's.
   */
  router.get("/api/visibility", async ({ request, env }) => {
    await requireUser(env, request);
    return json({ visibility: await readVisibilitySetting(env) });
  });

  router.put("/api/visibility", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<Record<string, unknown>>(request);

    const next: Visibility = { ...DEFAULT_VISIBILITY };
    for (const area of AREAS) {
      const value = body[area];
      if (value === undefined) continue;
      if (typeof value !== "string" || !ROLES.includes(value as Role)) {
        throw badRequest(`"${String(value)}" is not a grade.`);
      }
      const role = value as Role;
      // Refused rather than silently clamped: a Partner who tries to open personnel
      // information to Associates should be told why they cannot, not left believing
      // they did.
      if (ROLE_RANK[role] < ROLE_RANK[AREA_SPECS[area].floor]) {
        throw badRequest(
          `${AREA_SPECS[area].label} cannot be opened below ${ROLE_LABELS[AREA_SPECS[area].floor]} grade. ` +
            (AREA_SPECS[area].floorReason ?? ""),
        );
      }
      next[area] = role;
    }

    await writeSetting(env, "nav_visibility", writeVisibility(next), actor.id);
    return json({ visibility: next, changed_by: actor.full_name });
  });

  /**
   * Logo and colours, with no sign-in required, so the sign-in page can already
   * be the firm's own. Deliberately a separate endpoint rather than relaxing
   * /api/settings, which also carries the welcome message and firm details.
   */
  router.get("/api/branding", async ({ env }) => {
    const settings = await readSettings(env);
    const branding: Record<string, string> = {};
    for (const key of PUBLIC_KEYS) branding[key] = settings[key];
    return json({ branding });
  });

  /** Readable by any signed-in user - the welcome message is for everyone. */
  router.get("/api/settings", async ({ request, env }) => {
    await requireUser(env, request);
    return json({ settings: withoutTokens(await readSettings(env)) });
  });

  /**
   * What the Worker can see of the email settings, and who would be emailed.
   *
   * Restricted to the grade that can change these settings, and it never returns the
   * API key. It exists because email failing silently is the correct behaviour for a
   * missing setting and a terrible experience: without this, "no email arrived" has
   * five possible causes and no way to tell them apart from inside the firm.
   */
  router.get("/api/email/status", async ({ request, env }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const settings = await readSettings(env);
    const diagnosis = emailDiagnosis(env);

    const counts = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'active' AND email_notifications = 1 THEN 1 ELSE 0 END) AS opted_in
       FROM users`,
    ).first<{ active: number; opted_in: number }>();

    return json({
      email: diagnosis,
      firm_name: settings.firm_name,
      recipients: {
        active: counts?.active ?? 0,
        opted_in: counts?.opted_in ?? 0,
      },
    });
  });

  /**
   * Sends one test message to whoever asked for it, and reports what the provider
   * said.
   *
   * To the caller's own address only: not a field, so this cannot be turned into a
   * way of sending mail from the firm's domain to an address of somebody's choosing.
   */
  router.post("/api/email/test", async ({ request, env, url }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const settings = await readSettings(env);
    const result = await sendTestEmail(
      env,
      { email: actor.email, full_name: actor.full_name },
      settings.firm_name,
      url.origin,
    );
    return json({ ...result, to: actor.email });
  });

  router.patch("/api/settings", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<Record<string, unknown>>(request);

    const updates = EDITABLE.filter((key) => body[key] !== undefined).map((key) => {
      // The welcome message is long-form markdown and the logo is a data URI;
      // everything else is a short field.
      const value = optionalString(body[key], key, MAX_LENGTH[key] ?? 200) ?? "";
      if (key === "logo_data_url" || key === "logo_dark_data_url") {
        return { key, value: assertLogo(value) };
      }
      if (key === "primary_color" || key === "secondary_color") {
        return { key, value: assertColour(value, key) };
      }
      return { key, value };
    });
    if (!updates.length) throw badRequest("No settings supplied.");

    const timestamp = nowIso();
    await env.DB.batch(
      updates.map(({ key, value }) =>
        env.DB.prepare(
          `INSERT INTO settings (key, value, updated_at, updated_by)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (key) DO UPDATE
             SET value = excluded.value,
                 updated_at = excluded.updated_at,
                 updated_by = excluded.updated_by`,
        ).bind(key, value, timestamp, actor.id),
      ),
    );

    return json({ settings: withoutTokens(await readSettings(env)) });
  });
}

/**
 * Writes one setting. Used by the intake-link endpoint, which owns values that
 * /api/settings deliberately refuses to touch.
 */
export async function writeSetting(
  env: Env,
  key: string,
  value: string,
  actorId: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE
       SET value = excluded.value,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
  )
    .bind(key, value, nowIso(), actorId)
    .run();
}
