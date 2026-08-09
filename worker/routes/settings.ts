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
};

const EDITABLE = Object.keys(DEFAULTS);

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
  /** Readable by any signed-in user — the welcome message is for everyone. */
  router.get("/api/settings", async ({ request, env }) => {
    await requireUser(env, request);
    return json({ settings: await readSettings(env) });
  });

  router.patch("/api/settings", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<Record<string, unknown>>(request);

    const updates = EDITABLE.filter((key) => body[key] !== undefined).map((key) => ({
      key,
      // The welcome message is long-form markdown; the rest are short fields.
      value:
        optionalString(body[key], key, key === "welcome_message" ? 20_000 : 200) ?? "",
    }));
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
