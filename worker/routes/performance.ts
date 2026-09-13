/**
 * Probation and annual reviews.
 *
 * `shared/performance.ts` holds the criteria, the scale and the rules about who may do
 * what; this is where those rules meet the database. Named `performance` rather than
 * `reviews` because `routes/reviews.ts` already exists and means something else
 * entirely - the review points raised against a deliverable.
 *
 * Three things this file is careful about:
 *
 * **A draft is private to its author.** Half-formed judgements about a colleague are not
 * readable by that colleague, and `canReadReview` enforces it on every path rather than
 * the screen simply not linking to them.
 *
 * **The employee's comments are theirs alone.** No reviewer route writes that column,
 * and no employee route writes any other. A record where the reviewer could edit the
 * reply is not a record of a conversation.
 *
 * **A complete review is frozen.** Once both signatures are on it nothing amends it -
 * not the ratings, not the narrative, not the outcome. A performance record that can be
 * revised after the fact is worth nothing at the moment it is needed, which is the only
 * moment it is needed.
 */

import type { Env } from "../env";
import { requireUser, type AuthenticatedUser } from "../auth";
import {
  hrEventStatement,
  newId,
  notificationStatement,
  nowIso,
  optionalDate,
  optionalEnum,
  optionalString,
  requireEnum,
  requireString,
} from "../db";
import { Router, badRequest, forbidden, json, notFound, readJson } from "../http";
import { MIN_HR_ADMIN_ROLE, isHrAdmin } from "../../shared/hr";
import { ROLE_RANK, type Role } from "../../shared/workflow";
import {
  OBJECTIVE_STATUSES,
  OVERALL_OUTCOMES,
  PROBATION_DECISIONS,
  RATINGS,
  REVIEW_KINDS,
  REVIEW_KIND_LABELS,
  canReadReview,
  canReview,
  criteriaFor,
  criterionByKey,
  describeShareProblem,
  type ReviewKind,
  type ReviewStatus,
} from "../../shared/performance";

interface ReviewRow {
  id: string;
  subject_id: string;
  kind: ReviewKind;
  status: ReviewStatus;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  reviewer_id: string | null;
  overall: string | null;
  strengths: string | null;
  development: string | null;
  reviewer_comments: string | null;
  employee_comments: string | null;
  probation_decision: string | null;
  probation_extend_to: string | null;
  reviewer_signed_at: string | null;
  employee_signed_at: string | null;
  shared_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The subject's identity and reporting line, which is what the access rules turn on. */
async function loadSubject(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT u.id, u.full_name, u.role, p.line_manager_id
       FROM users u
       LEFT JOIN employee_profiles p ON p.user_id = u.id
      WHERE u.id = ?`,
  )
    .bind(userId)
    .first<{
      id: string;
      full_name: string;
      role: Role;
      line_manager_id: string | null;
    }>();
  if (!row) throw notFound("That person does not exist.");
  return row;
}

async function loadReview(env: Env, id: string): Promise<ReviewRow> {
  const row = await env.DB.prepare(
    `SELECT * FROM performance_reviews WHERE id = ?`,
  )
    .bind(id)
    .first<ReviewRow>();
  if (!row) throw notFound("That review does not exist.");
  return row;
}

/** Everything the review screen needs, in one shape. */
async function loadFull(env: Env, review: ReviewRow) {
  const subject = await loadSubject(env, review.subject_id);
  const [ratings, objectives, people] = await env.DB.batch([
    env.DB.prepare(
      `SELECT criterion, rating, comment FROM review_ratings WHERE review_id = ?`,
    ).bind(review.id),
    env.DB.prepare(
      `SELECT id, objective, target_date, status, assessment, position, source_review_id,
              assessed_in_id
         FROM review_objectives
        WHERE source_review_id = ?1 OR assessed_in_id = ?1
        ORDER BY position`,
    ).bind(review.id),
    env.DB.prepare(
      `SELECT id, full_name FROM users WHERE id IN (?1, ?2)`,
    ).bind(review.subject_id, review.reviewer_id ?? review.subject_id),
  ]);

  const names = new Map(
    (people.results as Array<{ id: string; full_name: string }>).map((r) => [
      r.id,
      r.full_name,
    ]),
  );

  return {
    ...review,
    subject_name: subject.full_name,
    subject_role: subject.role,
    reviewer_name: review.reviewer_id ? (names.get(review.reviewer_id) ?? null) : null,
    /** The criteria that apply at this person's grade, so the form matches the job. */
    criteria: criteriaFor(subject.role),
    ratings: ratings.results,
    objectives: objectives.results,
  };
}

/** Resolves the review and refuses anybody who may not read it. */
async function readable(env: Env, actor: AuthenticatedUser, id: string) {
  const review = await loadReview(env, id);
  const subject = await loadSubject(env, review.subject_id);
  if (!canReadReview(actor, subject, review.status, isHrAdmin(actor.role))) {
    throw forbidden("This review is not yours to read.");
  }
  return { review, subject };
}

/** Resolves the review and refuses anybody who may not write it. */
async function writable(env: Env, actor: AuthenticatedUser, id: string) {
  const review = await loadReview(env, id);
  const subject = await loadSubject(env, review.subject_id);
  if (!canReview(actor, subject, isHrAdmin(actor.role))) {
    throw forbidden(
      "Only this person's line manager, or a Partner, may write their review.",
    );
  }
  if (review.status === "complete") {
    throw badRequest(
      "This review is complete and signed by both parties, so it can no longer be changed. Record anything further in a new review.",
    );
  }
  return { review, subject };
}

export function registerPerformanceRoutes(router: Router<Env>): void {
  /** The reference data the form is built from. */
  router.get("/api/performance/criteria", async ({ request, env, url }) => {
    const actor = await requireUser(env, request);
    const forRole = url.searchParams.get("role");
    const role = forRole ? requireEnum(forRole, "role", ["associate","senior_associate","manager","partner","admin"] as const) : actor.role;
    return json({ criteria: criteriaFor(role) });
  });

  /**
   * One person's reviews.
   *
   * Drafts are filtered out for the subject themselves rather than refused, so their own
   * page simply does not show a review still being written - which is the honest
   * behaviour, since telling them one exists is most of what a draft would have told
   * them.
   */
  router.get("/api/people/:id/reviews", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const subject = await loadSubject(env, params.id);
    const isSelf = actor.id === subject.id;

    if (!isSelf && !canReview(actor, subject, isHrAdmin(actor.role))) {
      throw forbidden("You cannot see this person's reviews.");
    }

    const { results } = await env.DB.prepare(
      `SELECT r.id, r.kind, r.status, r.period_label, r.period_start, r.period_end,
              r.overall, r.probation_decision, r.reviewer_signed_at, r.employee_signed_at,
              r.completed_at, r.created_at,
              u.full_name AS reviewer_name
         FROM performance_reviews r
         LEFT JOIN users u ON u.id = r.reviewer_id
        WHERE r.subject_id = ?1
          ${isSelf && !isHrAdmin(actor.role) ? "AND r.status != 'draft'" : ""}
        ORDER BY COALESCE(r.period_end, r.created_at) DESC`,
    )
      .bind(subject.id)
      .all();

    const objectives = await env.DB.prepare(
      `SELECT id, objective, target_date, status, position
         FROM review_objectives
        WHERE subject_id = ? AND status = 'open'
        ORDER BY position`,
    )
      .bind(subject.id)
      .all();

    return json({
      subject: { id: subject.id, full_name: subject.full_name, role: subject.role },
      can_review: canReview(actor, subject, isHrAdmin(actor.role)),
      reviews: results,
      open_objectives: objectives.results,
    });
  });

  /** Starts a review. */
  router.post("/api/people/:id/reviews", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const subject = await loadSubject(env, params.id);
    if (!canReview(actor, subject, isHrAdmin(actor.role))) {
      throw forbidden(
        actor.id === subject.id
          ? "You cannot write your own review. Ask another Partner to do it."
          : "Only this person's line manager, or a Partner, may write their review.",
      );
    }

    const body = await readJson<Record<string, unknown>>(request);
    const kind = requireEnum(body.kind, "kind", REVIEW_KINDS);
    const timestamp = nowIso();
    const id = newId();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO performance_reviews
           (id, subject_id, kind, period_label, period_start, period_end, reviewer_id,
            status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      ).bind(
        id,
        subject.id,
        kind,
        optionalString(body.period_label, "period_label", 60),
        optionalDate(body.period_start, "period_start"),
        optionalDate(body.period_end, "period_end"),
        actor.id,
        actor.id,
        timestamp,
        timestamp,
      ),
      hrEventStatement(env, {
        subjectId: subject.id,
        actorId: actor.id,
        kind: "review:started",
        detail: `${REVIEW_KIND_LABELS[kind]} started`,
      }),
    ]);

    return json({ review: await loadFull(env, await loadReview(env, id)) }, 201);
  });

  /** One review in full. */
  router.get("/api/reviews/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const { review } = await readable(env, actor, params.id);
    return json({
      review: await loadFull(env, review),
      can_write:
        review.status !== "complete" &&
        canReview(
          actor,
          await loadSubject(env, review.subject_id),
          isHrAdmin(actor.role),
        ),
      is_subject: actor.id === review.subject_id,
    });
  });

  /** The reviewer's half: period, narrative, outcome, probation decision. */
  router.patch("/api/reviews/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const { review } = await writable(env, actor, params.id);
    const body = await readJson<Record<string, unknown>>(request);

    /*
     * Once shared, the person has read it. Amending the judgement underneath them at
     * that point - after they have seen it and possibly replied to it - is the one edit
     * that would make the record dishonest, so the reviewer's half is closed here and
     * only the recall below reopens it.
     */
    if (review.status === "shared") {
      throw badRequest(
        "This review is with the employee. Recall it first if you need to change what you wrote.",
      );
    }

    const fields: Record<string, unknown> = {
      period_label: optionalString(body.period_label, "period_label", 60),
      period_start: optionalDate(body.period_start, "period_start"),
      period_end: optionalDate(body.period_end, "period_end"),
      overall: optionalEnum(body.overall, "overall", OVERALL_OUTCOMES),
      strengths: optionalString(body.strengths, "strengths", 4000),
      development: optionalString(body.development, "development", 4000),
      reviewer_comments: optionalString(body.reviewer_comments, "reviewer_comments", 4000),
      probation_decision: optionalEnum(
        body.probation_decision,
        "probation_decision",
        PROBATION_DECISIONS,
      ),
      probation_extend_to: optionalDate(body.probation_extend_to, "probation_extend_to"),
    };

    const assignments: string[] = [];
    const binds: unknown[] = [];
    for (const [column, value] of Object.entries(fields)) {
      if (body[column] === undefined) continue;
      assignments.push(`${column} = ?`);
      binds.push(value);
    }
    if (!assignments.length) throw badRequest("No changes supplied.");

    assignments.push("updated_at = ?");
    binds.push(nowIso(), params.id);

    await env.DB.prepare(
      `UPDATE performance_reviews SET ${assignments.join(", ")} WHERE id = ?`,
    )
      .bind(...binds)
      .run();

    return json({ review: await loadFull(env, await loadReview(env, params.id)) });
  });

  /** One rating, with its comment. */
  router.put("/api/reviews/:id/ratings/:criterion", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const { review } = await writable(env, actor, params.id);
    if (review.status === "shared") {
      throw badRequest(
        "This review is with the employee. Recall it first if you need to change a rating.",
      );
    }

    if (!criterionByKey(params.criterion)) {
      throw badRequest(`"${params.criterion}" is not one of the review criteria.`);
    }

    const body = await readJson<{ rating?: unknown; comment?: unknown }>(request);
    const rating = optionalEnum(body.rating, "rating", RATINGS);
    const comment = optionalString(body.comment, "comment", 2000);

    /*
     * A rating below expectation without a comment is the failure this guards against.
     * "Below expectation" and nothing else tells the person nothing they can act on, and
     * is the version of a review that is worth least precisely when it matters most.
     */
    if (rating === "below" && !comment) {
      throw badRequest(
        "A rating below expectation needs a comment saying what has to change. Somebody has to be able to act on it.",
      );
    }

    await env.DB.prepare(
      `INSERT INTO review_ratings (review_id, criterion, rating, comment)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (review_id, criterion) DO UPDATE
         SET rating = excluded.rating, comment = excluded.comment`,
    )
      .bind(params.id, params.criterion, rating, comment)
      .run();

    await env.DB.prepare(`UPDATE performance_reviews SET updated_at = ? WHERE id = ?`)
      .bind(nowIso(), params.id)
      .run();

    return json({ review: await loadFull(env, await loadReview(env, params.id)) });
  });

  /** Sets an objective, on this review, for the period ahead. */
  router.post("/api/reviews/:id/objectives", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const { review } = await writable(env, actor, params.id);
    const body = await readJson<Record<string, unknown>>(request);

    const objective = requireString(body.objective, "objective", { max: 500 });
    const timestamp = nowIso();
    const id = newId();

    const next = await env.DB.prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM review_objectives
        WHERE source_review_id = ?`,
    )
      .bind(params.id)
      .first<{ n: number }>();

    await env.DB.prepare(
      `INSERT INTO review_objectives
         (id, subject_id, source_review_id, objective, target_date, status, position,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
      .bind(
        id,
        review.subject_id,
        params.id,
        objective,
        optionalDate(body.target_date, "target_date"),
        next?.n ?? 0,
        timestamp,
        timestamp,
      )
      .run();

    return json({ review: await loadFull(env, await loadReview(env, params.id)) }, 201);
  });

  /**
   * Judges an objective set in an earlier review.
   *
   * `assessed_in_id` records which review closed it, so an objective set last year and
   * judged this year is readable from both ends.
   */
  router.patch("/api/reviews/:id/objectives/:objectiveId", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const { review } = await writable(env, actor, params.id);
    const body = await readJson<Record<string, unknown>>(request);

    const existing = await env.DB.prepare(
      `SELECT id, subject_id FROM review_objectives WHERE id = ?`,
    )
      .bind(params.objectiveId)
      .first<{ id: string; subject_id: string }>();
    if (!existing || existing.subject_id !== review.subject_id) {
      throw notFound("That objective is not on this person's file.");
    }

    const status = optionalEnum(body.status, "status", OBJECTIVE_STATUSES);
    const assessment = optionalString(body.assessment, "assessment", 2000);
    const objective =
      body.objective === undefined
        ? undefined
        : requireString(body.objective, "objective", { max: 500 });

    const assignments: string[] = [];
    const binds: unknown[] = [];
    if (body.status !== undefined) {
      assignments.push("status = ?", "assessed_in_id = ?");
      binds.push(status, params.id);
    }
    if (body.assessment !== undefined) {
      assignments.push("assessment = ?");
      binds.push(assessment);
    }
    if (objective !== undefined) {
      assignments.push("objective = ?");
      binds.push(objective);
    }
    if (body.target_date !== undefined) {
      assignments.push("target_date = ?");
      binds.push(optionalDate(body.target_date, "target_date"));
    }
    if (!assignments.length) throw badRequest("No changes supplied.");

    assignments.push("updated_at = ?");
    binds.push(nowIso(), params.objectiveId);

    await env.DB.prepare(
      `UPDATE review_objectives SET ${assignments.join(", ")} WHERE id = ?`,
    )
      .bind(...binds)
      .run();

    return json({ review: await loadFull(env, await loadReview(env, params.id)) });
  });

  router.delete("/api/reviews/:id/objectives/:objectiveId", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const { review } = await writable(env, actor, params.id);
    await env.DB.prepare(
      `DELETE FROM review_objectives WHERE id = ? AND subject_id = ? AND source_review_id = ?`,
    )
      .bind(params.objectiveId, review.subject_id, params.id)
      .run();
    return json({ review: await loadFull(env, await loadReview(env, params.id)) });
  });

  /**
   * Signs the reviewer's half and sends it to the person.
   *
   * Everything has to be rated and an outcome chosen first - a half-finished review put
   * in front of somebody is worse than none, because they will read the gaps as a
   * judgement too.
   */
  router.post("/api/reviews/:id/share", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const { review, subject } = await writable(env, actor, params.id);
    if (review.status === "shared") throw badRequest("This review is already with them.");

    const full = await loadFull(env, review);
    const problem = describeShareProblem({
      kind: review.kind,
      overall: full.overall as never,
      ratings: full.ratings as never,
      applicable: full.criteria,
      probation_decision: review.probation_decision as never,
      probation_extend_to: review.probation_extend_to,
    });
    if (problem) throw badRequest(problem);

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE performance_reviews
            SET status = 'shared', shared_at = ?, reviewer_signed_at = ?, reviewer_id = ?,
                updated_at = ?
          WHERE id = ?`,
      ).bind(timestamp, timestamp, actor.id, timestamp, params.id),
      notificationStatement(env, {
        userId: subject.id,
        taskId: null,
        kind: "review:shared",
        title: `Your ${REVIEW_KIND_LABELS[review.kind].toLowerCase()} is ready`,
        body: "Read it, add anything you want on the record, and sign it.",
      }),
      hrEventStatement(env, {
        subjectId: subject.id,
        actorId: actor.id,
        kind: "review:shared",
        detail: `${REVIEW_KIND_LABELS[review.kind]} shared with ${subject.full_name}`,
      }),
    ]);

    return json({ review: await loadFull(env, await loadReview(env, params.id)) });
  });

  /** Takes it back from the person, to correct something before they sign. */
  router.post("/api/reviews/:id/recall", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const { review, subject } = await writable(env, actor, params.id);
    if (review.status !== "shared") throw badRequest("This review is not with them.");

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE performance_reviews
            SET status = 'draft', shared_at = NULL, reviewer_signed_at = NULL, updated_at = ?
          WHERE id = ?`,
      ).bind(nowIso(), params.id),
      /*
       * Recorded in the HR trail, not silently. Somebody read a judgement about
       * themselves and it was then withdrawn and changed; whatever the reason, that is
       * a fact the file should carry.
       */
      hrEventStatement(env, {
        subjectId: subject.id,
        actorId: actor.id,
        kind: "review:recalled",
        detail: `${REVIEW_KIND_LABELS[review.kind]} withdrawn from ${subject.full_name} for amendment`,
      }),
    ]);

    return json({ review: await loadFull(env, await loadReview(env, params.id)) });
  });

  /**
   * The employee's half: their own comments, and their signature.
   *
   * Only the subject may call this, and it writes only their two columns. Signing does
   * not mean agreeing - it means they have read it - and the screen says so, because a
   * signature block that implies consent it did not get is worse than no signature.
   */
  router.post("/api/reviews/:id/respond", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const review = await loadReview(env, params.id);

    if (actor.id !== review.subject_id) {
      throw forbidden("Only the person being reviewed can respond to it.");
    }
    if (review.status !== "shared") {
      throw badRequest(
        review.status === "complete"
          ? "You have already signed this review."
          : "This review has not been shared with you yet.",
      );
    }

    const body = await readJson<{ comments?: unknown; sign?: unknown }>(request);
    const comments = optionalString(body.comments, "comments", 4000);
    const signing = body.sign === true;
    const timestamp = nowIso();

    const statements = [
      env.DB.prepare(
        `UPDATE performance_reviews
            SET employee_comments = ?,
                employee_signed_at = CASE WHEN ?2 = 1 THEN ?3 ELSE employee_signed_at END,
                status = CASE WHEN ?2 = 1 THEN 'complete' ELSE status END,
                completed_at = CASE WHEN ?2 = 1 THEN ?3 ELSE completed_at END,
                updated_at = ?3
          WHERE id = ?4`,
      ).bind(comments, signing ? 1 : 0, timestamp, params.id),
    ];

    if (signing) {
      statements.push(
        hrEventStatement(env, {
          subjectId: review.subject_id,
          actorId: actor.id,
          kind: "review:completed",
          detail: `${REVIEW_KIND_LABELS[review.kind]} signed by the employee`,
        }),
      );
      if (review.reviewer_id) {
        statements.push(
          notificationStatement(env, {
            userId: review.reviewer_id,
            taskId: null,
            kind: "review:completed",
            title: `${REVIEW_KIND_LABELS[review.kind]} signed`,
            body: "The review is complete and can no longer be changed.",
          }),
        );
      }
    }

    await env.DB.batch(statements);
    return json({ review: await loadFull(env, await loadReview(env, params.id)) });
  });

  /**
   * Reviews that are somebody's to deal with, for the dashboard.
   *
   * Two queues, because they are two different jobs: drafts this person has started and
   * not finished, and reviews waiting on their own signature.
   */
  router.get("/api/me/reviews", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    const [mine, awaiting] = await env.DB.batch([
      env.DB.prepare(
        `SELECT r.id, r.kind, r.status, r.period_label, u.full_name AS subject_name
           FROM performance_reviews r
           JOIN users u ON u.id = r.subject_id
          WHERE r.reviewer_id = ? AND r.status IN ('draft','shared')
          ORDER BY r.updated_at DESC`,
      ).bind(actor.id),
      env.DB.prepare(
        `SELECT r.id, r.kind, r.status, r.period_label, u.full_name AS reviewer_name
           FROM performance_reviews r
           LEFT JOIN users u ON u.id = r.reviewer_id
          WHERE r.subject_id = ? AND r.status = 'shared'
          ORDER BY r.shared_at DESC`,
      ).bind(actor.id),
    ]);

    return json({ writing: mine.results, awaiting_my_signature: awaiting.results });
  });

  /**
   * Everyone's review position, for whoever runs HR.
   *
   * Ratings and narrative are deliberately absent: this answers "who is overdue a
   * review" and nothing more. Reading what a review says means opening it, which the
   * access rules govern one person at a time.
   */
  router.get("/api/performance/overview", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    if (ROLE_RANK[actor.role] < ROLE_RANK[MIN_HR_ADMIN_ROLE]) {
      throw forbidden("Your grade does not permit this.");
    }

    const { results } = await env.DB.prepare(
      `SELECT u.id, u.full_name, u.role, p.employment_status, p.start_date,
              p.probation_end_date, p.confirmed_on,
              (SELECT COUNT(*) FROM performance_reviews r
                WHERE r.subject_id = u.id AND r.status = 'complete') AS completed,
              (SELECT MAX(r.completed_at) FROM performance_reviews r
                WHERE r.subject_id = u.id AND r.status = 'complete') AS last_review_at,
              (SELECT r.status FROM performance_reviews r
                WHERE r.subject_id = u.id AND r.status != 'complete'
                ORDER BY r.updated_at DESC LIMIT 1) AS in_progress
         FROM users u
         LEFT JOIN employee_profiles p ON p.user_id = u.id
        WHERE u.status = 'active'
        ORDER BY u.full_name`,
    ).all();

    return json({ people: results });
  });
}
