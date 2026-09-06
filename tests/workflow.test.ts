/**
 * The professional controls, as tests.
 *
 * `shared/workflow.ts` is the one module both the Worker and the browser authorise
 * against, so a mistake in it is a mistake in the firm's segregation of duties rather
 * than a bug in a screen. The README makes specific promises about it - nobody reviews
 * their own work, an Associate cannot be a reviewer, must-fix points block sign-off,
 * only a Partner reopens a closed file - and until now nothing checked that the code
 * still kept them.
 *
 * Each test below is one of those promises.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  atLeast,
  availableActions,
  can,
  isOpen,
  ROLE_RANK,
  ROLES,
  STATUS_LABELS,
  TASK_STATUSES,
  TRANSITIONS,
  type Role,
  type TaskStatus,
  type WorkflowTask,
} from "../shared/workflow";

const PREPARER = { id: "u-preparer", role: "associate" as Role };
const REVIEWER = { id: "u-reviewer", role: "senior_associate" as Role };
const MANAGER = { id: "u-manager", role: "manager" as Role };
const PARTNER = { id: "u-partner", role: "partner" as Role };

function task(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    status: "in_progress",
    assignee_id: PREPARER.id,
    reviewer_id: REVIEWER.id,
    ...overrides,
  };
}

const clean = { review: { unansweredMustFix: 0, unresolvedMustFix: 0 } };

// ---------------------------------------------------------------------------
// Segregation of duties
// ---------------------------------------------------------------------------

test("nobody reviews their own work, at any grade", () => {
  for (const role of ROLES) {
    const self = { id: "u-self", role };
    const own = task({ status: "under_review", assignee_id: "u-self", reviewer_id: "u-self" });

    for (const action of ["begin_review", "request_rework", "approve"] as const) {
      const decision = can(action, { ...own, status: action === "begin_review" ? "submitted" : "under_review" }, self, clean);
      assert.equal(
        decision.allowed,
        false,
        `${role} was allowed to ${action} their own deliverable`,
      );
    }
  }
});

test("an admin cannot override segregation of duties", () => {
  const admin = { id: "u-admin", role: "admin" as Role };
  const decision = can(
    "approve",
    task({ status: "under_review", assignee_id: "u-admin" }),
    admin,
    clean,
  );
  assert.equal(decision.allowed, false);
});

test("an associate cannot review, even when named as the reviewer", () => {
  const associate = { id: "u-other", role: "associate" as Role };
  const decision = can(
    "begin_review",
    task({ status: "submitted", reviewer_id: "u-other" }),
    associate,
    clean,
  );
  assert.equal(decision.allowed, false);
});

test("a senior associate who did not prepare it may review", () => {
  assert.equal(
    can("begin_review", task({ status: "submitted" }), REVIEWER, clean).allowed,
    true,
  );
});

// ---------------------------------------------------------------------------
// Review-point gates
// ---------------------------------------------------------------------------

test("an unresolved must-fix point blocks approval", () => {
  const decision = can("approve", task({ status: "under_review" }), REVIEWER, {
    review: { unansweredMustFix: 0, unresolvedMustFix: 1 },
  });
  assert.equal(decision.allowed, false);
  assert.match((decision as { reason: string }).reason, /not yet resolved or waived/);
});

test("an unanswered must-fix point blocks resubmission", () => {
  const decision = can("resubmit", task({ status: "rework" }), PREPARER, {
    review: { unansweredMustFix: 2, unresolvedMustFix: 2 },
  });
  assert.equal(decision.allowed, false);
  assert.match((decision as { reason: string }).reason, /no response yet/);
});

test("outstanding mandatory checklist steps block submission", () => {
  const decision = can("submit", task({ status: "in_progress" }), PREPARER, {
    checklist: { mandatoryOutstanding: 3 },
  });
  assert.equal(decision.allowed, false);
  assert.match((decision as { reason: string }).reason, /3 mandatory checklist steps/);
});

test("a clean deliverable submits and approves", () => {
  assert.equal(
    can("submit", task({ status: "in_progress" }), PREPARER, {
      ...clean,
      checklist: { mandatoryOutstanding: 0 },
    }).allowed,
    true,
  );
  assert.equal(
    can("approve", task({ status: "under_review" }), REVIEWER, clean).allowed,
    true,
  );
});

// ---------------------------------------------------------------------------
// Grade thresholds
// ---------------------------------------------------------------------------

test("a manager closes an approved file; an associate does not", () => {
  assert.equal(can("close", task({ status: "approved" }), MANAGER, clean).allowed, true);
  assert.equal(can("close", task({ status: "approved" }), PREPARER, clean).allowed, false);
});

test("only a partner reopens a closed file", () => {
  assert.equal(can("reopen", task({ status: "closed" }), MANAGER, clean).allowed, false);
  assert.equal(can("reopen", task({ status: "closed" }), PARTNER, clean).allowed, true);
});

test("role ranks are strictly increasing in the declared order", () => {
  for (let i = 1; i < ROLES.length; i++) {
    assert.ok(
      ROLE_RANK[ROLES[i]] > ROLE_RANK[ROLES[i - 1]],
      `${ROLES[i]} does not outrank ${ROLES[i - 1]}`,
    );
    assert.equal(atLeast(ROLES[i], ROLES[i - 1]), true);
    assert.equal(atLeast(ROLES[i - 1], ROLES[i]), false);
  }
});

// ---------------------------------------------------------------------------
// The shape of the machine itself
// ---------------------------------------------------------------------------

test("an action is refused from every status it is not declared for", () => {
  for (const rule of TRANSITIONS) {
    for (const status of TASK_STATUSES) {
      if (rule.from.includes(status)) continue;
      const decision = can(rule.action, task({ status }), PARTNER, clean);
      assert.equal(
        decision.allowed,
        false,
        `${rule.action} was allowed from ${status}`,
      );
    }
  }
});

test("closed and cancelled are terminal apart from reopening", () => {
  for (const status of ["closed", "cancelled"] as TaskStatus[]) {
    const offered = TRANSITIONS.filter((t) => t.from.includes(status)).map((t) => t.action);
    assert.deepEqual(offered, ["reopen"], `${status} offers more than reopen`);
    assert.equal(isOpen(status), false);
  }
});

test("every transition lands in a real status and every status has a label", () => {
  for (const rule of TRANSITIONS) {
    assert.ok(TASK_STATUSES.includes(rule.to), `${rule.action} lands on ${rule.to}`);
    for (const from of rule.from) {
      assert.ok(TASK_STATUSES.includes(from), `${rule.action} starts from ${from}`);
    }
  }
  for (const status of TASK_STATUSES) {
    assert.ok(STATUS_LABELS[status], `${status} has no label`);
  }
});

test("no two rules claim the same action from the same status", () => {
  const seen = new Set<string>();
  for (const rule of TRANSITIONS) {
    for (const from of rule.from) {
      const key = `${rule.action}@${from}`;
      assert.equal(seen.has(key), false, `${key} is declared twice`);
      seen.add(key);
    }
  }
});

test("availableActions offers exactly what the current status declares", () => {
  const offered = availableActions(task({ status: "under_review" }), REVIEWER, clean);
  assert.deepEqual(
    offered.map((o) => o.rule.action).sort(),
    ["approve", "cancel", "request_rework"],
  );
  // A blocked action is still offered, with its reason, so the UI can explain itself
  // rather than hiding the button.
  const blocked = availableActions(task({ status: "under_review" }), PREPARER, clean).find(
    (o) => o.rule.action === "approve",
  );
  assert.equal(blocked?.permission.allowed, false);
});
