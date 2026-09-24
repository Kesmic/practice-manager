/**
 * The devices a member of staff wants to be told on.
 *
 * A device enrols itself: the browser asks the person, the push service issues an
 * endpoint and keys, and the page hands them here against the person's own session.
 * Nothing here takes a user id from the request, so nobody can enrol a device against
 * anybody but themselves, and nobody can remove a device but its owner.
 */

import type { Env } from "../env";
import { requireUser } from "../auth";
import { newId, nowIso } from "../db";
import { Router, badRequest, json, noContent, readJson } from "../http";
import { fromBase64url, pushConfigured, pushToUser } from "../push";

export function registerPushRoutes(router: Router<Env>): void {
  /** Whether the portal can push at all, and the key a browser subscribes with. */
  router.get("/api/push/key", async ({ request, env }) => {
    await requireUser(env, request);
    return json({
      configured: pushConfigured(env),
      public_key: pushConfigured(env) ? env.VAPID_PUBLIC_KEY : null,
    });
  });

  /** Enrols this device, or refreshes it. */
  router.put("/api/push/subscriptions", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    if (!pushConfigured(env)) throw badRequest("Push notifications are not set up on this portal.");
    const body = await readJson<{
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    }>(request);
    const endpoint = String(body.endpoint ?? "").trim();
    const p256dh = String(body.keys?.p256dh ?? "").trim();
    const auth = String(body.keys?.auth ?? "").trim();
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000) {
      throw badRequest("That is not a push endpoint.");
    }
    let point: Uint8Array;
    let secret: Uint8Array;
    try {
      point = fromBase64url(p256dh);
      secret = fromBase64url(auth);
    } catch {
      throw badRequest("The device's keys are not readable.");
    }
    if (point.length !== 65 || point[0] !== 4 || secret.length !== 16) {
      throw badRequest("The device's keys are not the right shape.");
    }

    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO push_subscriptions
         (id, user_id, endpoint, p256dh, auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
             user_agent = excluded.user_agent, failed_at = NULL`,
    )
      .bind(
        newId(),
        actor.id,
        endpoint,
        p256dh,
        auth,
        (request.headers.get("user-agent") ?? "").slice(0, 300) || null,
        timestamp,
      )
      .run();
    return noContent();
  });

  /** Forgets this device. Only its owner can. */
  router.delete("/api/push/subscriptions", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    const body = await readJson<{ endpoint?: unknown }>(request);
    const endpoint = String(body.endpoint ?? "").trim();
    if (!endpoint) throw badRequest("Say which device.");
    await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`)
      .bind(endpoint, actor.id)
      .run();
    return noContent();
  });

  /** How many devices this person has enrolled, for the account page. */
  router.get("/api/push/subscriptions", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?`,
    )
      .bind(actor.id)
      .first<{ n: number }>();
    return json({ devices: row?.n ?? 0 });
  });

  /** A test message to every device this person has enrolled. */
  router.post("/api/push/test", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    if (!pushConfigured(env)) throw badRequest("Push notifications are not set up on this portal.");
    const sent = await pushToUser(env, actor.id, {
      title: "Push is working",
      body: "This is the portal, saying hello on this device.",
      url: "/account",
      tag: "push-test",
    });
    return json({ sent });
  });
}
