/** Firm-wide settings: identity and the Managing Director's welcome message. */

import type { Env } from "../env";
import { requireRole, requireUser } from "../auth";
import { nowIso, optionalString } from "../db";
import { Router, badRequest, json, readJson } from "../http";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";

/** The settings the portal reads, with the defaults used before they are set. */
const DEFAULTS: Record<string, string> = {
  firm_name: "Kesmic Consulting",
  firm_website: "https://www.kesmic.org",
  md_name: "",
  md_title: "Managing Director",
  welcome_message: "",
  /* Appearance. Empty means "use the built-in default". */
  logo_data_url: "",
  primary_color: "",
  secondary_color: "",
};

const EDITABLE = Object.keys(DEFAULTS);

/**
 * The subset of settings that describe how the portal looks. These are readable
 * without signing in, so the firm's logo and colours appear on the sign-in screen
 * itself. None of it is confidential — it is what every visitor would see anyway.
 */
const PUBLIC_KEYS = ["firm_name", "logo_data_url", "primary_color", "secondary_color"];

/** Longest value each setting may hold. */
const MAX_LENGTH: Record<string, number> = {
  welcome_message: 20_000,
  // A data URI for the logo. 400,000 characters is roughly a 290 kB image, which
  // is generous for a logo and comfortably inside what a D1 row will hold.
  logo_data_url: 400_000,
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

export function registerSettingsRoutes(router: Router<Env>): void {
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

  /** Readable by any signed-in user — the welcome message is for everyone. */
  router.get("/api/settings", async ({ request, env }) => {
    await requireUser(env, request);
    return json({ settings: await readSettings(env) });
  });

  router.patch("/api/settings", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<Record<string, unknown>>(request);

    const updates = EDITABLE.filter((key) => body[key] !== undefined).map((key) => {
      // The welcome message is long-form markdown and the logo is a data URI;
      // everything else is a short field.
      const value = optionalString(body[key], key, MAX_LENGTH[key] ?? 200) ?? "";
      if (key === "logo_data_url") return { key, value: assertLogo(value) };
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

    return json({ settings: await readSettings(env) });
  });
}
