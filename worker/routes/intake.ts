/**
 * Client intake: two public links, and the queue they feed.
 *
 * The public half of this file is the only part of the portal an anonymous visitor
 * can post to, so it is written defensively:
 *
 * - **The link is the credential.** Each kind of request has its own random token in
 *   the path. Without it the endpoint answers 404 and says nothing about whether the
 *   firm uses the portal at all. Rotating a token retires a link that has leaked
 *   without touching anything else.
 * - **Nothing is confirmed to the sender.** An existing client types the name it
 *   knows itself by, and the response is the same whether or not that name matches a
 *   client of the firm. Otherwise the form becomes a way to ask "is this company a
 *   client of Kesmic", which is confidential.
 * - **A submission creates no records other than its own.** It is a request for
 *   attention. A client record appears only when somebody at Manager grade accepts
 *   it, having read what was typed.
 * - **Bounded.** Body size, every field's length, and how often one sender may
 *   submit are all capped, so neither a stuck submit button nor a script can fill
 *   the table.
 */

import type { Env } from "../env";
import { requireRole } from "../auth";
import {
  assertExists,
  newId,
  nextRef,
  normaliseEmail,
  nowIso,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalString,
  requireEnum,
  requireString,
} from "../db";
import {
  Router,
  badRequest,
  conflict,
  json,
  notFound,
  readJson,
  tooMany,
} from "../http";
import {
  CLIENT_STATUSES,
  ENTITY_TYPES,
  MIN_SUPERVISOR_ROLE,
  SERVICE_LINES,
  SERVICE_LINE_LABELS,
} from "../../shared/workflow";
import {
  MAX_SERVICES,
  REQUEST_KINDS,
  REQUEST_LIMITS,
  REQUEST_RATE,
  REQUEST_STATUSES,
  SERVICE_KEY_PATTERN,
  serviceKeyFrom,
  type IntakeService,
  type RequestKind,
} from "../../shared/intake";
import { notifyIntake } from "../email";
import { readSettings, requireArea, writeSetting } from "./settings";

/** Which setting holds each link's token. */
const TOKEN_KEY: Record<RequestKind, string> = {
  new: "intake_token_new",
  existing: "intake_token_existing",
};

/**
 * 24 bytes as hex. Long enough that guessing is hopeless, short enough that the
 * whole link still fits on one line of an email.
 */
function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compared without an early return, so the timing says nothing about the token. */
function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Resolves a public request to its kind, or refuses.
 *
 * Both failures answer 404 with the same words. A wrong token and a retired link are
 * indistinguishable from outside, which is the point.
 */
async function requireLink(env: Env, kindParam: string, token: string) {
  const kind = REQUEST_KINDS.includes(kindParam as RequestKind)
    ? (kindParam as RequestKind)
    : null;
  const dead = notFound("This link is not valid. Please ask the firm for a current one.");
  if (!kind) throw dead;

  const settings = await readSettings(env);
  if (!sameToken(settings[TOKEN_KEY[kind]] ?? "", token)) throw dead;
  return { kind, settings };
}

/**
 * Two caps in one query: how many this sender has made, and how many the link has
 * taken. Counted over the same window so one row does the work of two.
 */
async function assertWithinRate(env: Env, kind: RequestKind, ipHash: string) {
  const since = new Date(Date.now() - REQUEST_RATE.windowMinutes * 60_000).toISOString();
  const row = await env.DB.prepare(
    // SUM(CASE ...) rather than COUNT(*) FILTER: the aggregate FILTER clause needs a
    // recent SQLite, and there is nothing to gain by depending on that here.
    `SELECT
       SUM(CASE WHEN ip_hash = ?1 THEN 1 ELSE 0 END) AS from_sender,
       SUM(CASE WHEN kind = ?2 THEN 1 ELSE 0 END)    AS on_link
     FROM client_requests
     WHERE created_at >= ?3`,
  )
    .bind(ipHash, kind, since)
    .first<{ from_sender: number; on_link: number }>();

  if (!row) return;
  if (row.from_sender >= REQUEST_RATE.perSender) {
    throw tooMany(
      "You have already sent this form a few times in the last hour. If you need to add something, please reply to the acknowledgement instead.",
    );
  }
  if (row.on_link >= REQUEST_RATE.perLink) {
    throw tooMany(
      "This form is temporarily busy. Please try again in an hour, or email the firm directly.",
    );
  }
}

/**
 * The service list the public form offers, as the firm has it.
 *
 * Falls back to the firm's own service lines when nothing has been configured, so a
 * fresh deployment has a sensible list rather than an empty one, and so the firm only
 * has to touch this if the defaults are wrong for them.
 */
function serviceList(settings: Record<string, string>): IntakeService[] {
  const raw = settings.intake_services;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const out = parsed
          .filter((s) => s && typeof s.key === "string" && typeof s.label === "string")
          .map((s) => ({ key: String(s.key), label: String(s.label) }));
        if (out.length) return out;
      }
    } catch {
      // A malformed list must not take the public form down with it.
      console.error("intake_services is not valid JSON; using the defaults.");
    }
  }
  return SERVICE_LINES.map((key) => ({ key, label: SERVICE_LINE_LABELS[key] }));
}

/** Validates the services a sender ticked against the list actually on offer. */
function readServices(value: unknown, offered: IntakeService[]): string[] {
  if (!Array.isArray(value) || !value.length) {
    throw badRequest("Please choose at least one service you would like help with.");
  }
  const allowed = offered.map((s) => s.key);
  const out: string[] = [];
  for (const entry of value) {
    const service = requireEnum(entry, "services", allowed);
    if (!out.includes(service)) out.push(service);
  }
  return out;
}

/** Parses and checks a list an administrator has submitted. */
function assertServiceList(value: unknown): IntakeService[] {
  if (!Array.isArray(value) || !value.length) {
    throw badRequest("Keep at least one service on the list, or the form cannot be used.");
  }
  if (value.length > MAX_SERVICES) {
    throw badRequest(
      `That is ${value.length} services. Keep it to ${MAX_SERVICES} or fewer, or nobody will read the list.`,
    );
  }
  const out: IntakeService[] = [];
  for (const entry of value) {
    const label = requireString((entry as Record<string, unknown>)?.label, "label", {
      max: 80,
    });
    const rawKey = (entry as Record<string, unknown>)?.key;
    const key = typeof rawKey === "string" && rawKey ? rawKey : serviceKeyFrom(label);
    if (!SERVICE_KEY_PATTERN.test(key)) {
      throw badRequest(
        `"${label}" does not give a usable reference. Use letters and numbers in the name.`,
      );
    }
    if (out.some((s) => s.key === key)) {
      throw badRequest(`Two services would share the reference "${key}". Reword one of them.`);
    }
    out.push({ key, label });
  }
  return out;
}

/** MM-DD, as on the clients table. Optional, and forgiving about a full date. */
function readFiscalYearEnd(value: unknown): string | null {
  const text = optionalString(value, "fiscal_year_end", 10);
  if (!text) return null;
  const match = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) {
    throw badRequest(
      `Please give the financial year end as month and day, for example 12-31.`,
    );
  }
  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw badRequest("That is not a real month and day.");
  }
  return `${match[1]}-${match[2]}`;
}

/** An address that could plausibly receive the acknowledgement. */
function readEmail(value: unknown): string {
  const email = normaliseEmail(value);
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    throw badRequest("Please check the email address - the firm will reply to it.");
  }
  if (email.length > REQUEST_LIMITS.contact_email) {
    throw badRequest("That email address is too long.");
  }
  return email;
}

const REQUEST_SELECT = `
  SELECT r.*, c.name AS client_name, c.code AS client_code, u.full_name AS handled_by_name
    FROM client_requests r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN users u ON u.id = r.handled_by`;

/**
 * A row as it comes out of the database: `services` is still JSON text here, and
 * every other column is whatever the sender typed.
 */
interface RequestRow {
  id: string;
  reference: string;
  kind: RequestKind;
  status: string;
  organisation: string;
  client_ref: string | null;
  client_id: string | null;
  entity_type: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  tax_id: string | null;
  registration_no: string | null;
  industry: string | null;
  fiscal_year_end: string | null;
  address: string | null;
  services: string;
  details: string | null;
  preferred_start: string | null;
  handled_by: string | null;
  handled_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Prepares a row to be sent to a screen: services parsed back from JSON, and the
 * sender's hashed address dropped.
 *
 * The hash exists only to rate limit, and it is derived from an IP address, so it
 * has no business being on anybody's screen or in any browser's memory. Removed here
 * rather than by naming columns in the SELECT, so a column added to the table later
 * cannot quietly start being served.
 */
function shape(row: Record<string, unknown> | RequestRow): Record<string, unknown> {
  let services: string[] = [];
  try {
    const parsed = JSON.parse(String(row.services ?? "[]"));
    if (Array.isArray(parsed)) services = parsed.map(String);
  } catch {
    // A row written before this code, or by hand. Showing none is better than
    // failing the whole screen.
    services = [];
  }
  const { ip_hash: _ip, ...rest } = row as Record<string, unknown>;
  return { ...rest, services };
}

export function registerIntakeRoutes(router: Router<Env>): void {
  // ------------------------------------------------------------------ public

  /**
   * Confirms a link is live and tells the form which of the two it is. Carries the
   * firm's name and website only; the logo and colours come from /api/branding,
   * which the app already loads for the sign-in screen.
   */
  router.get("/api/intake/:kind/:token", async ({ env, params }) => {
    const { kind, settings } = await requireLink(env, params.kind, params.token);
    return json({
      form: {
        kind,
        firm_name: settings.firm_name,
        firm_website: settings.firm_website,
        services: serviceList(settings),
      },
    });
  });

  router.post("/api/intake/:kind/:token", async ({ request, env, params, waitUntil, url }) => {
    const { kind, settings } = await requireLink(env, params.kind, params.token);
    const body = await readJson<Record<string, unknown>>(request, {
      maxBytes: REQUEST_LIMITS.body_bytes,
    });

    // Salted with the token so the same address at two different links, or after a
    // rotation, does not produce the same hash. Cloudflare sets the header; locally
    // it is absent, which simply means one bucket for everybody.
    const ipHash = await hash(
      `${request.headers.get("CF-Connecting-IP") ?? "local"}:${params.token}`,
    );
    await assertWithinRate(env, kind, ipHash);

    const organisation = requireString(body.organisation, "organisation", {
      max: REQUEST_LIMITS.organisation,
    });
    const contactName = requireString(body.contact_name, "contact_name", {
      max: REQUEST_LIMITS.contact_name,
    });
    const contactEmail = readEmail(body.contact_email);
    const services = readServices(body.services, serviceList(settings));

    const id = newId();
    const reference = await nextRef(env, "request", "REQ", 4);
    const timestamp = nowIso();

    await env.DB.prepare(
      `INSERT INTO client_requests
         (id, reference, kind, status, organisation, client_ref, entity_type,
          contact_name, contact_email, contact_phone, tax_id, registration_no,
          industry, fiscal_year_end, address, services, details, preferred_start,
          ip_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        reference,
        kind,
        organisation,
        optionalString(body.client_ref, "client_ref", REQUEST_LIMITS.client_ref),
        optionalEnum(body.entity_type, "entity_type", ENTITY_TYPES),
        contactName,
        contactEmail,
        optionalString(body.contact_phone, "contact_phone", REQUEST_LIMITS.contact_phone),
        optionalString(body.tax_id, "tax_id", REQUEST_LIMITS.tax_id),
        optionalString(
          body.registration_no,
          "registration_no",
          REQUEST_LIMITS.registration_no,
        ),
        optionalString(body.industry, "industry", REQUEST_LIMITS.industry),
        readFiscalYearEnd(body.fiscal_year_end),
        optionalString(body.address, "address", REQUEST_LIMITS.address),
        JSON.stringify(services),
        optionalString(body.details, "details", REQUEST_LIMITS.details),
        optionalDate(body.preferred_start, "preferred_start"),
        ipHash,
        timestamp,
        timestamp,
      )
      .run();

    // The inbox is the system of record, so it is written inside the request rather
    // than in waitUntil: a request nobody can see is worse than a slow response.
    const { results: recipients } = await env.DB.prepare(
      `SELECT id FROM users
        WHERE status = 'active' AND role IN ('manager','partner','admin')`,
    ).all<{ id: string }>();

    const heading =
      kind === "new"
        ? `New client enquiry from ${organisation}`
        : `${organisation} has asked for more work`;

    if (recipients.length) {
      await env.DB.batch(
        recipients.map((recipient) =>
          env.DB.prepare(
            `INSERT INTO notifications (id, user_id, task_id, kind, title, body, created_at)
             VALUES (?, ?, NULL, 'client_request', ?, ?, ?)`,
          ).bind(
            newId(),
            recipient.id,
            `${reference}: ${heading}`,
            `${contactName} (${contactEmail}) asked about ${services.length} service(s). Open Client requests to deal with it.`,
            timestamp,
          ),
        ),
      );
    }

    await notifyIntake(env, waitUntil, {
      reference,
      origin: url.origin,
      firmName: settings.firm_name,
      subject: `${reference}: ${heading}`,
      headline: `${heading}. ${contactName} left ${contactEmail}${
        body.contact_phone ? ` and a phone number` : ""
      }.`,
      detail: optionalString(body.details, "details", REQUEST_LIMITS.details),
    });

    // Only the reference goes back. Nothing is echoed that the sender did not send,
    // and nothing is revealed about what the firm now knows.
    return json({ reference }, 201);
  });

  // ------------------------------------------------------------------- staff

  router.get("/api/client-requests", async ({ request, env, url }) => {
    await requireArea(env, request, "client_requests");

    const filters: string[] = [];
    const binds: unknown[] = [];

    const status = url.searchParams.get("status");
    if (status) {
      filters.push(`r.status = ?`);
      binds.push(requireEnum(status, "status", REQUEST_STATUSES));
    }
    const kind = url.searchParams.get("kind");
    if (kind) {
      filters.push(`r.kind = ?`);
      binds.push(requireEnum(kind, "kind", REQUEST_KINDS));
    }

    const { results } = await env.DB.prepare(
      `${REQUEST_SELECT}
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY
          CASE r.status WHEN 'new' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
          r.created_at DESC
        LIMIT 500`,
    )
      .bind(...binds)
      .all<Record<string, unknown>>();

    const open = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM client_requests WHERE status IN ('new','in_review')`,
    ).first<{ n: number }>();

    return json({ requests: results.map(shape), open: open?.n ?? 0 });
  });

  router.get("/api/client-requests/:id", async ({ request, env, params }) => {
    await requireArea(env, request, "client_requests");
    const row = await env.DB.prepare(`${REQUEST_SELECT} WHERE r.id = ?`)
      .bind(params.id)
      .first<Record<string, unknown>>();
    if (!row) throw notFound("That request does not exist.");
    return json({ request: shape(row) });
  });

  /**
   * Progress and decisions other than acceptance: taking a request on, declining
   * it, matching it to a client, or noting what was decided.
   */
  router.patch("/api/client-requests/:id", async ({ request, env, params }) => {
    const actor = await requireArea(env, request, "client_requests");
    const existing = await loadRequest(env, params.id);
    const body = await readJson<Record<string, unknown>>(request);

    const status = optionalEnum(body.status, "status", REQUEST_STATUSES);
    if (status === "accepted") {
      throw badRequest(
        "Use Accept rather than setting the status, so the client record is created or matched at the same time.",
      );
    }

    let clientId = existing.client_id;
    if (body.client_id !== undefined) {
      clientId = body.client_id === null || body.client_id === "" ? null : String(body.client_id);
      if (clientId) {
        const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`)
          .bind(clientId)
          .first<{ id: string }>();
        if (!client) throw notFound("That client does not exist.");
      }
    }

    const decided = status === "declined";
    await env.DB.prepare(
      `UPDATE client_requests
          SET status = ?, client_id = ?, decision_note = ?,
              handled_by = ?, handled_at = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(
        status ?? existing.status,
        clientId,
        body.decision_note === undefined
          ? existing.decision_note
          : optionalString(body.decision_note, "decision_note", 2000),
        // Whoever last touched it owns it, which is what the queue needs to show.
        actor.id,
        decided || status === "in_review" ? nowIso() : existing.handled_at,
        nowIso(),
        params.id,
      )
      .run();

    return json({ request: shape(await loadRequest(env, params.id)) });
  });

  /**
   * Accepts a request.
   *
   * For a new client this is where the client record is created, from the submitted
   * details, as a **prospect**: accepting an enquiry means the firm will act on it,
   * not that an engagement exists. For an existing client the caller has to say
   * which file it belongs to, because the portal will not guess.
   */
  router.post("/api/client-requests/:id/accept", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const existing = await loadRequest(env, params.id);
    const body = await readJson<Record<string, unknown>>(request).catch(() => ({}) as Record<string, unknown>);

    if (existing.status === "accepted") {
      throw conflict("That request has already been accepted.");
    }

    const chosen =
      body.client_id === undefined || body.client_id === null || body.client_id === ""
        ? null
        : String(body.client_id);

    let clientId: string;
    let created = false;

    if (chosen) {
      const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`)
        .bind(chosen)
        .first<{ id: string }>();
      if (!client) throw notFound("That client does not exist.");
      clientId = chosen;
    } else if (existing.kind === "existing") {
      throw badRequest(
        "Choose which client this belongs to before accepting it. The name was typed by the sender, so only you can confirm the right file.",
      );
    } else {
      clientId = await createClientFrom(env, existing, actor.id, body);
      created = true;
    }

    const timestamp = nowIso();
    await env.DB.prepare(
      `UPDATE client_requests
          SET status = 'accepted', client_id = ?, decision_note = ?,
              handled_by = ?, handled_at = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(
        clientId,
        body.decision_note === undefined
          ? existing.decision_note
          : optionalString(body.decision_note, "decision_note", 2000),
        actor.id,
        timestamp,
        timestamp,
        params.id,
      )
      .run();

    return json({
      request: shape(await loadRequest(env, params.id)),
      client_id: clientId,
      created_client: created,
    });
  });

  // ------------------------------------------------------------------- links

  /**
   * The two links. Creating them on first read rather than making it a separate
   * step: there is nothing to decide, and a screen that shows two empty boxes with a
   * button next to them is a worse screen.
   */
  router.get("/api/intake-links", async ({ request, env, url }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const links = [];
    for (const kind of REQUEST_KINDS) {
      links.push(await ensureLink(env, kind, actor.id, url.origin));
    }
    return json({ links });
  });

  /**
   * The service list, for the screen that edits it. Returns whatever is in use,
   * whether that is the firm's own list or the defaults it started from.
   */
  router.get("/api/intake-services", async ({ request, env }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const settings = await readSettings(env);
    return json({
      services: serviceList(settings),
      customised: Boolean(settings.intake_services),
    });
  });

  /**
   * Replaces the whole list rather than editing one entry at a time, because the
   * order is part of it and reordering is the commonest change after wording.
   *
   * Keys of services already chosen on past requests are not protected: an old
   * request keeps the key it was submitted with, and the review screen falls back to
   * showing that key if the service has since been removed. Renaming is therefore
   * always safe, and removing costs only the label on historic requests.
   */
  router.put("/api/intake-services", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<{ services?: unknown }>(request);
    const services = assertServiceList(body.services);
    await writeSetting(env, "intake_services", JSON.stringify(services), actor.id);
    return json({ services, customised: true });
  });

  /** Puts the built-in service lines back, for when an edit has gone wrong. */
  router.delete("/api/intake-services", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    await writeSetting(env, "intake_services", "", actor.id);
    const settings = await readSettings(env);
    return json({ services: serviceList(settings), customised: false });
  });

  /**
   * Replaces one link. The old address stops working immediately, which is the
   * point: it is what you do when a link has been forwarded somewhere it should not
   * have been, or is attracting rubbish.
   */
  router.post("/api/intake-links/:kind/rotate", async ({ request, env, params, url }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const kind = requireEnum(params.kind, "kind", REQUEST_KINDS);
    await writeSetting(env, TOKEN_KEY[kind], newToken(), actor.id);
    return json({ link: await ensureLink(env, kind, actor.id, url.origin) });
  });
}

async function loadRequest(env: Env, id: string): Promise<RequestRow> {
  const row = await env.DB.prepare(`${REQUEST_SELECT} WHERE r.id = ?`)
    .bind(id)
    .first<RequestRow>();
  if (!row) throw notFound("That request does not exist.");
  return row;
}

/** Reads a link, minting the token the first time it is asked for. */
async function ensureLink(env: Env, kind: RequestKind, actorId: string, origin: string) {
  const key = TOKEN_KEY[kind];
  const row = await env.DB.prepare(
    `SELECT value, updated_at FROM settings WHERE key = ?`,
  )
    .bind(key)
    .first<{ value: string; updated_at: string }>();

  if (row?.value) {
    return { kind, url: `${origin}/request/${kind}/${row.value}`, created_at: row.updated_at };
  }

  const token = newToken();
  await writeSetting(env, key, token, actorId);
  return { kind, url: `${origin}/request/${kind}/${token}`, created_at: nowIso() };
}

/**
 * Creates the client an accepted new-client request describes.
 *
 * The submitted details are copied across, but the things that are the firm's
 * judgement rather than the sender's - risk rating, who owns the relationship - are
 * left at their defaults or taken from the person accepting. A prospective client
 * does not get to set its own risk rating.
 */
async function createClientFrom(
  env: Env,
  submission: RequestRow,
  actorId: string,
  body: Record<string, unknown>,
): Promise<string> {
  const partnerId = optionalId(body.partner_id, "partner_id");
  const managerId = optionalId(body.manager_id, "manager_id");
  await assertExists(env, "users", partnerId, "The selected engagement partner");
  await assertExists(env, "users", managerId, "The selected manager");

  const id = newId();
  const code = await nextRef(env, "client", "CLI", 4);
  const timestamp = nowIso();

  await env.DB.prepare(
    `INSERT INTO clients (id, code, name, entity_type, tax_id, registration_no, industry,
                          fiscal_year_end, contact_name, contact_email, contact_phone,
                          address, risk_rating, status, partner_id, manager_id,
                          onboarded_on, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'medium', ?, ?, ?, NULL, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      code,
      submission.organisation,
      submission.entity_type ?? "company",
      submission.tax_id,
      submission.registration_no,
      submission.industry,
      submission.fiscal_year_end,
      submission.contact_name,
      submission.contact_email,
      submission.contact_phone,
      submission.address,
      optionalEnum(body.status, "status", CLIENT_STATUSES) ?? "prospect",
      partnerId,
      managerId,
      `Created from client request ${submission.reference}.`,
      actorId,
      timestamp,
      timestamp,
    )
    .run();

  return id;
}
