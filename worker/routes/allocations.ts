/**
 * Allocating a client to somebody, and their right to decline it.
 *
 * `shared/allocations.ts` sets out why an allocation is an offer rather than a column,
 * and why the grounds for declining are named rather than typed. This is where those
 * rules meet the database.
 *
 * The rule this file exists to enforce, and the one worth reading the code for:
 *
 * **Accepting and declining belong to the person the client was offered to.** Not to
 * their manager, not to a partner, not to an administrator. Every other action here is
 * the firm's; these two are not, because a right somebody else can exercise on your
 * behalf is not a right, and clause 8.2 gives the Associate the right, not the firm.
 *
 * Two smaller things follow from the same thought. A decline carries its ground, so the
 * record says whether it counted against the person rather than leaving that to be read
 * out of a free-text reason months later. And the person who made the offer is told the
 * answer, because a right exercised into silence gets exercised once.
 */

import type { Env } from "../env";
import { requireUser, type AuthenticatedUser } from "../auth";
import { newId, notificationStatement, nowIso, optionalString, requireEnum } from "../db";
import { Router, badRequest, conflict, forbidden, json, notFound, readJson } from "../http";
import {
  ALLOCATION_STATUSES,
  CLIENT_TIERS,
  DECLINE_GROUNDS,
  GROUND_SPECS,
  type AllocationAction,
  type AllocationStatus,
  type DeclineGround,
  availableAllocationActions,
  describeAllocationProblem,
  describeDecline,
} from "../../shared/allocations";
import { isEngagedNotEmployed } from "../../shared/onboarding";
import { EMPLOYMENT_TYPES, type EmploymentType } from "../../shared/hr";
import { MIN_SUPERVISOR_ROLE, ROLE_RANK, type Role } from "../../shared/workflow";

/** Who may offer a client to somebody, withdraw an offer, or reallocate away. */
const MIN_ALLOCATE_ROLE: Role = MIN_SUPERVISOR_ROLE;

const MAX_NOTE = 1_000;
const MAX_REASON = 2_000;

function canAllocate(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_ALLOCATE_ROLE];
}

interface AllocationRow extends Record<string, unknown> {
  id: string;
  client_id: string;
  user_id: string;
  status: AllocationStatus;
}

export function registerAllocationRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // Offering
  // -------------------------------------------------------------------------

  router.post("/api/clients/:id/allocations", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    if (!canAllocate(actor.role)) {
      throw forbidden("Allocating a client is restricted to Manager grade and above.");
    }

    const body = await readJson<{
      user_id?: unknown;
      tier?: unknown;
      note?: unknown;
    }>(request);

    const userId = String(body.user_id ?? "").trim();
    if (!userId) throw badRequest("Choose who this client is being allocated to.");

    const tier =
      body.tier === undefined || body.tier === null || body.tier === ""
        ? null
        : requireEnum(body.tier, "tier", CLIENT_TIERS);
    const note = optionalString(body.note, "note", MAX_NOTE);

    const [client, person] = await Promise.all([
      env.DB.prepare(`SELECT id, name FROM clients WHERE id = ?`)
        .bind(params.id)
        .first<{ id: string; name: string }>(),
      env.DB.prepare(`SELECT id, full_name, status FROM users WHERE id = ?`)
        .bind(userId)
        .first<{ id: string; full_name: string; status: string }>(),
    ]);
    if (!client) throw notFound("That client does not exist.");
    if (!person) throw badRequest("That person does not exist.");
    if (person.status !== "active") {
      throw badRequest("That account is not active, so nothing can be allocated to it.");
    }

    /*
     * The partial unique index would reject a second live allocation anyway, but a
     * constraint violation reaches the caller as a database error rather than as a
     * sentence they can act on.
     */
    const live = await env.DB.prepare(
      `SELECT id, status FROM client_allocations
        WHERE client_id = ? AND user_id = ? AND status IN ('offered','accepted')`,
    )
      .bind(params.id, userId)
      .first<{ id: string; status: AllocationStatus }>();
    if (live) {
      throw conflict(
        live.status === "accepted"
          ? `${client.name} is already assigned to ${person.full_name}.`
          : `${person.full_name} already has an unanswered offer for ${client.name}.`,
      );
    }

    const id = newId();
    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO client_allocations
           (id, client_id, user_id, tier, status, offered_by, offered_at, note)
         VALUES (?, ?, ?, ?, 'offered', ?, ?, ?)`,
      ).bind(id, params.id, userId, tier, actor.id, timestamp, note),
      notificationStatement(env, {
        userId,
        taskId: null,
        kind: "allocation:offered",
        title: `${client.name} has been offered to you`,
        body:
          "Accept it, or decline it if taking it on would stop you performing properly " +
          "for a client already assigned to you. Declining on that ground is not a breach " +
          "of your agreement.",
      }),
    ]);

    return json({ allocation: await loadAllocation(env, id) }, 201);
  });

  // -------------------------------------------------------------------------
  // Answering
  // -------------------------------------------------------------------------

  /**
   * Accepting. Theirs alone, which is why the check is on `user_id` rather than on
   * grade: a partner accepting on somebody's behalf would make clause 8.2 unexercisable.
   */
  router.post("/api/allocations/:id/accept", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const allocation = await readAllocation(env, params.id);
    assertSubject(actor, allocation, "accept");
    assertPossible(allocation.status, "accept");

    const timestamp = nowIso();
    const applied = await env.DB.batch([
      env.DB.prepare(
        `UPDATE client_allocations
            SET status = 'accepted', responded_at = ?
          WHERE id = ? AND status = 'offered'`,
      ).bind(timestamp, params.id),
      notificationStatement(env, {
        userId: String(allocation.offered_by ?? ""),
        taskId: null,
        kind: "allocation:accepted",
        title: `${allocation.client_name} accepted`,
        body: `${actor.full_name} has accepted ${allocation.client_name}.`,
      }),
    ]);

    // The guard is on the status, so a second click loses rather than double-applying.
    if ((applied[0]?.meta?.changes ?? 0) === 0) {
      throw conflict("That offer was answered or withdrawn a moment ago.");
    }

    return json({ allocation: await loadAllocation(env, params.id) });
  });

  /**
   * Declining, on a named ground.
   *
   * The ground is required and comes from a list rather than from prose. Somebody
   * exercising clause 8.2 should not have to know it is clause 8.2, and the firm should
   * not have to read a paragraph and decide afterwards which right was being used.
   */
  router.post("/api/allocations/:id/decline", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const allocation = await readAllocation(env, params.id);
    assertSubject(actor, allocation, "decline");
    assertPossible(allocation.status, "decline");

    const body = await readJson<{ ground?: unknown; reason?: unknown }>(request);
    const ground = requireEnum(body.ground, "ground", DECLINE_GROUNDS) as DeclineGround;
    const reason = optionalString(body.reason, "reason", MAX_REASON);

    /*
     * A reason is required on the unprotected ground and optional on the others. The
     * protected grounds are assertions of professional judgement, and demanding that
     * somebody justify exercising a right the agreement gives them unconditionally
     * would put a condition on it that the agreement does not.
     */
    if (GROUND_SPECS[ground].breach && !reason) {
      throw badRequest("Say why you are declining.");
    }

    const timestamp = nowIso();
    const engaged = await isOnAssociateAgreement(env, actor.id);

    const applied = await env.DB.batch([
      env.DB.prepare(
        `UPDATE client_allocations
            SET status = 'declined', responded_at = ?,
                decline_ground = ?, decline_reason = ?
          WHERE id = ? AND status = 'offered'`,
      ).bind(timestamp, ground, reason, params.id),
      notificationStatement(env, {
        userId: String(allocation.offered_by ?? ""),
        taskId: null,
        kind: "allocation:declined",
        title: `${allocation.client_name} declined`,
        body: `${actor.full_name} has declined ${allocation.client_name}. ${describeDecline(
          ground,
          engaged,
        )}${reason ? ` They said: ${reason}` : ""}`,
      }),
    ]);

    if ((applied[0]?.meta?.changes ?? 0) === 0) {
      throw conflict("That offer was answered or withdrawn a moment ago.");
    }

    return json({
      allocation: await loadAllocation(env, params.id),
      // Said back to the person who just exercised the right, so they can see the
      // record reflects it. This is the whole point of naming the grounds.
      outcome: describeDecline(ground, engaged),
    });
  });

  // -------------------------------------------------------------------------
  // The firm's side
  // -------------------------------------------------------------------------

  router.post("/api/allocations/:id/withdraw", async ({ request, env, params }) => {
    return await firmAction(env, request, params.id, "withdraw");
  });

  router.post("/api/allocations/:id/end", async ({ request, env, params }) => {
    return await firmAction(env, request, params.id, "end");
  });

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** The person's own clients: what they hold, and what they have been offered. */
  router.get("/api/me/allocations", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    const { results } = await selectAllocations(env, `a.user_id = ?`, [actor.id]);
    return json({
      allocations: results.map((row) =>
        decorate(row, { isSubject: true, canAllocate: canAllocate(actor.role) }),
      ),
      on_associate_agreement: await isOnAssociateAgreement(env, actor.id),
    });
  });

  /** Who holds one client, and who has been offered it. */
  router.get("/api/clients/:id/allocations", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const { results } = await selectAllocations(env, `a.client_id = ?`, [params.id]);
    return json({
      allocations: results.map((row) =>
        decorate(row, {
          isSubject: row.user_id === actor.id,
          canAllocate: canAllocate(actor.role),
        }),
      ),
    });
  });

  /**
   * Every offer still waiting on an answer, for whoever allocates.
   *
   * The question a manager has: who have I asked, and who has not come back to me.
   */
  router.get("/api/allocations", async ({ request, env, url }) => {
    const actor = await requireUser(env, request);
    if (!canAllocate(actor.role)) {
      throw forbidden("Allocations are visible to Manager grade and above.");
    }
    const status = url.searchParams.get("status");
    const filter = status
      ? `a.status = ?`
      : `a.status IN ('offered','accepted')`;
    const binds = status
      ? [requireEnum(status, "status", ALLOCATION_STATUSES)]
      : [];

    const { results } = await selectAllocations(env, filter, binds);
    return json({
      allocations: results.map((row) =>
        decorate(row, {
          isSubject: row.user_id === actor.id,
          canAllocate: true,
        }),
      ),
    });
  });
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const ALLOCATION_SELECT = `
  SELECT a.*,
         c.name AS client_name,
         c.code AS client_code,
         u.full_name AS user_name,
         o.full_name AS offered_by_name
    FROM client_allocations a
    JOIN clients c ON c.id = a.client_id
    JOIN users u ON u.id = a.user_id
    LEFT JOIN users o ON o.id = a.offered_by
`;

async function selectAllocations(env: Env, where: string, binds: unknown[]) {
  return await env.DB.prepare(
    `${ALLOCATION_SELECT}
      WHERE ${where}
      ORDER BY
        CASE a.status WHEN 'offered' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
        a.offered_at DESC`,
  )
    .bind(...binds)
    .all<AllocationRow & { client_name: string }>();
}

/** Attaches what this viewer may do, so the screen does not re-derive the rules. */
function decorate(
  row: AllocationRow,
  options: { isSubject: boolean; canAllocate: boolean },
) {
  return {
    ...row,
    available_actions: availableAllocationActions(row.status, options),
  };
}

async function readAllocation(
  env: Env,
  id: string,
): Promise<AllocationRow & { client_name: string; offered_by: string | null }> {
  const row = await env.DB.prepare(`${ALLOCATION_SELECT} WHERE a.id = ?`)
    .bind(id)
    .first<AllocationRow & { client_name: string; offered_by: string | null }>();
  if (!row) throw notFound("That allocation does not exist.");
  return row;
}

async function loadAllocation(env: Env, id: string) {
  return await readAllocation(env, id);
}

/**
 * The check that makes clause 8.2 real: only the person it was offered to may answer.
 *
 * Grade is deliberately not a way round this. A partner is not entitled to accept a
 * client on an Associate's behalf, because the judgement the clause protects is the
 * Associate's own.
 */
function assertSubject(
  actor: AuthenticatedUser,
  allocation: AllocationRow,
  action: AllocationAction,
): void {
  if (allocation.user_id === actor.id) return;
  throw forbidden(
    action === "accept"
      ? "Only the person a client was offered to can accept it."
      : "Only the person a client was offered to can decline it. This judgement is theirs.",
  );
}

function assertPossible(status: AllocationStatus, action: AllocationAction): void {
  const problem = describeAllocationProblem(status, action);
  if (problem) throw conflict(problem);
}

/** Withdrawing an offer, or reallocating a held client away. Both the firm's to do. */
async function firmAction(
  env: Env,
  request: Request,
  id: string,
  action: "withdraw" | "end",
): Promise<Response> {
  const actor = await requireUser(env, request);
  if (!canAllocate(actor.role)) {
    throw forbidden("This is restricted to Manager grade and above.");
  }

  const allocation = await readAllocation(env, id);
  assertPossible(allocation.status, action);

  const body = await readJson<{ note?: unknown }>(request);
  const note = optionalString(body.note, "note", MAX_NOTE);
  const timestamp = nowIso();

  const from: AllocationStatus = action === "withdraw" ? "offered" : "accepted";
  const to: AllocationStatus = action === "withdraw" ? "withdrawn" : "ended";

  const applied = await env.DB.batch([
    env.DB.prepare(
      `UPDATE client_allocations
          SET status = ?, ended_at = ?, ended_by = ?, ended_note = ?
        WHERE id = ? AND status = ?`,
    ).bind(to, timestamp, actor.id, note, id, from),
    notificationStatement(env, {
      userId: allocation.user_id,
      taskId: null,
      kind: `allocation:${to}`,
      title:
        action === "withdraw"
          ? `The offer of ${allocation.client_name} has been withdrawn`
          : `${allocation.client_name} has been reallocated`,
      body:
        action === "withdraw"
          ? note ?? "You are no longer being asked to take this client on."
          : (note ?? "") +
            " Hand over the working papers, records and correspondence for this client.",
    }),
  ]);

  if ((applied[0]?.meta?.changes ?? 0) === 0) {
    throw conflict("That allocation changed a moment ago. Reload and try again.");
  }

  return json({ allocation: await loadAllocation(env, id) });
}

/**
 * Whether this person is engaged under the Associate agreement rather than employed.
 *
 * Used only to decide the wording: clause 8.2 is cited by number to somebody it applies
 * to, and described in plain terms to an employee, whose protection comes from the
 * firm's own position rather than from that clause.
 */
async function isOnAssociateAgreement(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT employment_type FROM employee_profiles WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ employment_type: string | null }>();
  const type = row?.employment_type;
  return (
    EMPLOYMENT_TYPES.includes(type as EmploymentType) &&
    isEngagedNotEmployed(type as EmploymentType)
  );
}
