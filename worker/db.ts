/** Shared database utilities: ids, references, audit events and notifications. */

import type { Env } from "./env";
import { badRequest, notFound } from "./http";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Allocates the next value of a named counter and formats a human reference.
 * The UPDATE ... RETURNING is a single statement, so concurrent callers cannot
 * be handed the same number.
 */
export async function nextRef(
  env: Env,
  counter: "task" | "client" | "engagement" | "request",
  prefix: string,
  width: number,
): Promise<string> {
  const row = await env.DB.prepare(
    `UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value`,
  )
    .bind(counter)
    .first<{ value: number }>();
  if (!row) throw new Error(`Counter "${counter}" is missing.`);
  return `${prefix}-${String(row.value).padStart(width, "0")}`;
}

/** Appends an immutable audit-trail entry. */
export function eventStatement(
  env: Env,
  input: {
    taskId: string;
    actorId: string | null;
    kind: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    detail?: string | null;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO task_events (id, task_id, actor_id, kind, from_status, to_status, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newId(),
    input.taskId,
    input.actorId,
    input.kind,
    input.fromStatus ?? null,
    input.toStatus ?? null,
    input.detail ?? null,
    nowIso(),
  );
}

export async function logEvent(
  env: Env,
  input: Parameters<typeof eventStatement>[1],
): Promise<void> {
  await eventStatement(env, input).run();
}

export function notificationStatement(
  env: Env,
  input: {
    userId: string;
    taskId: string | null;
    kind: string;
    title: string;
    body?: string | null;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO notifications (id, user_id, task_id, kind, title, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newId(),
    input.userId,
    input.taskId,
    input.kind,
    input.title,
    input.body ?? null,
    nowIso(),
  );
}

/**
 * Builds notification statements for a set of recipients, skipping duplicates
 * and skipping the actor - nobody needs telling about their own action.
 */
export function notifyMany(
  env: Env,
  recipients: Array<string | null | undefined>,
  actorId: string,
  payload: { taskId: string | null; kind: string; title: string; body?: string | null },
): D1PreparedStatement[] {
  const unique = [
    ...new Set(recipients.filter((id): id is string => !!id && id !== actorId)),
  ];
  return unique.map((userId) =>
    notificationStatement(env, { userId, ...payload }),
  );
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function requireString(
  value: unknown,
  field: string,
  { max = 2000, min = 1 }: { max?: number; min?: number } = {},
): string {
  if (typeof value !== "string") throw badRequest(`"${field}" must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`"${field}" is required.`);
  if (trimmed.length > max) {
    throw badRequest(`"${field}" must be ${max} characters or fewer.`);
  }
  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  max = 4000,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, field, { max });
}

export function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw badRequest(
      `"${field}" must be one of: ${allowed.join(", ")}.`,
      `Received: ${String(value)}`,
    );
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | null {
  if (value === undefined || value === null || value === "") return null;
  return requireEnum(value, field, allowed);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw badRequest(`"${field}" must be a date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`"${field}" is not a real date.`);
  }
  return value;
}

export function requireDate(value: unknown, field: string): string {
  const date = optionalDate(value, field);
  if (!date) throw badRequest(`"${field}" is required.`);
  return date;
}

export function optionalNumber(
  value: unknown,
  field: string,
  { min = 0, max = 1_000_000 }: { min?: number; max?: number } = {},
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) throw badRequest(`"${field}" must be a number.`);
  if (num < min || num > max) {
    throw badRequest(`"${field}" must be between ${min} and ${max}.`);
  }
  return num;
}

export function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, field, { max: 64 });
}

export function normaliseEmail(value: unknown): string {
  const email = requireString(value, "email", { max: 254 }).toLowerCase();
  // Deliberately permissive: reject only what is obviously not an address.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw badRequest("That does not look like a valid email address.");
  }
  return email;
}

/** Confirms a referenced row exists, so we return 400 rather than an FK error. */
export async function assertExists(
  env: Env,
  table: "users" | "clients" | "engagements" | "task_templates",
  id: string | null,
  label: string,
): Promise<void> {
  if (!id) return;
  const row = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ id: string }>();
  if (!row) throw badRequest(`${label} does not exist.`);
}

export async function loadOrFail<T>(
  env: Env,
  sql: string,
  binds: unknown[],
  message: string,
): Promise<T> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<T>();
  if (!row) throw notFound(message);
  return row;
}

/**
 * Builds a partial UPDATE from a whitelist of fields, so route handlers never
 * interpolate column names from request data.
 */
export function buildUpdate(
  table: string,
  allowed: Record<string, unknown>,
  where: { id: string },
): { sql: string; binds: unknown[] } | null {
  const entries = Object.entries(allowed).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return null;
  const assignments = entries.map(([column]) => `${column} = ?`);
  assignments.push(`updated_at = ?`);
  const binds = [...entries.map(([, value]) => value), nowIso(), where.id];
  return {
    sql: `UPDATE ${table} SET ${assignments.join(", ")} WHERE id = ?`,
    binds,
  };
}

/**
 * Appends to the HR audit trail. Kept separate from `task_events` because the
 * two trails have different subjects, different readers and different retention
 * expectations - an employment record is not a client deliverable.
 */
export function hrEventStatement(
  env: Env,
  input: {
    subjectId: string | null;
    actorId: string | null;
    kind: string;
    detail?: string | null;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO hr_events (id, subject_id, actor_id, kind, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    newId(),
    input.subjectId,
    input.actorId,
    input.kind,
    input.detail ?? null,
    nowIso(),
  );
}
