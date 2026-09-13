/**
 * The server side of security questions: storing answers, and checking them.
 *
 * The policy and the argument for why this is off by default live in
 * `shared/security-questions.ts`. What is here is everything that touches the database
 * or a key.
 */

import type { Env } from "./env";
import { newId, nowIso } from "./db";
import {
  MAX_ANSWER_LENGTH,
  MAX_QUESTION_LENGTH,
  describeSetProblem,
  normaliseAnswer,
  readQuestionsPolicy,
  type SecurityQuestionsPolicy,
} from "../shared/security-questions";

/**
 * How an answer's digest was keyed.
 *
 * `hmac` means a key derived from PASSWORD_PEPPER was used, so a leaked database cannot
 * be attacked offline at all. `salted` means no pepper is set on this deployment, and
 * the digest is only salted with the user id - which for a low-entropy answer is a
 * dictionary attack, not a barrier. The account screen reports which it is rather than
 * leaving a firm to assume the stronger one.
 */
export type AnswerScheme = "hmac" | "salted";

async function answerKey(env: Env): Promise<CryptoKey | null> {
  const pepper = env.PASSWORD_PEPPER;
  if (!pepper) return null;

  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper) as unknown as ArrayBuffer,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("kesmic-practice-manager") as unknown as ArrayBuffer,
      // Its own label, so this key cannot be used to reach the TOTP secrets sealed with
      // the same pepper, nor they to reach these.
      info: new TextEncoder().encode("security-answer-hmac") as unknown as ArrayBuffer,
    },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * The stored digest of one answer.
 *
 * The user id goes into the message in both schemes, so the same answer to the same
 * question by two people does not produce the same row - which would otherwise let
 * anybody with the database see that two colleagues drive the same make of car.
 *
 * A fast digest rather than a KDF, on purpose. PBKDF2 at the deployment's work factor
 * costs about 4 ms, and sign-in checks at least three answers at once: on the Workers
 * Free plan's 10 ms budget that request is killed rather than slowed, and the person
 * cannot sign in at all. The pepper is what does the work here - it is not in the
 * database, so there is nothing to run a dictionary against - which is the same bargain
 * `worker/auth.ts` already strikes for passwords, and the reason the fallback scheme is
 * reported rather than quietly accepted.
 */
export async function hashAnswer(
  env: Env,
  userId: string,
  answer: string,
): Promise<{ hash: string; scheme: AnswerScheme }> {
  const message = `${userId}:${normaliseAnswer(answer)}`;
  const key = await answerKey(env);
  if (!key) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(message) as unknown as ArrayBuffer,
    );
    return { hash: toHex(digest), scheme: "salted" };
  }
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message) as unknown as ArrayBuffer,
  );
  return { hash: toHex(mac), scheme: "hmac" };
}

export function questionsScheme(env: Env): AnswerScheme {
  return env.PASSWORD_PEPPER ? "hmac" : "salted";
}

export interface StoredQuestion {
  id: string;
  question: string;
  answer_hash: string;
  answer_scheme: AnswerScheme;
  position: number;
}

/** The firm's policy on whether questions may stand in for a code. */
export async function questionsPolicy(env: Env): Promise<SecurityQuestionsPolicy> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("security_questions")
    .first<{ value: string }>();
  return readQuestionsPolicy(row?.value);
}

/** This person's enrolled questions, in the order they are asked. */
export async function loadQuestions(
  env: Env,
  userId: string,
): Promise<StoredQuestion[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, question, answer_hash, answer_scheme, position
       FROM user_security_questions
      WHERE user_id = ?
      ORDER BY position`,
  )
    .bind(userId)
    .all<StoredQuestion>();
  return results;
}

/** Just the questions, for the sign-in screen, without the answers. */
export async function questionPrompts(
  env: Env,
  userId: string,
): Promise<Array<{ id: string; question: string }>> {
  const rows = await loadQuestions(env, userId);
  return rows.map((row) => ({ id: row.id, question: row.question }));
}

export async function hasQuestions(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM user_security_questions WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

/**
 * Replaces the whole set.
 *
 * Whole set rather than one at a time: an enrolment is three or more questions asked
 * together, and letting them be edited individually would allow a set to sit in a state
 * with too few to be a factor.
 */
export async function replaceQuestions(
  env: Env,
  userId: string,
  entries: Array<{ question: string; answer: string }>,
): Promise<{ problem: string | null }> {
  const trimmed = entries.map((entry) => ({
    question: String(entry.question ?? "").trim().slice(0, MAX_QUESTION_LENGTH),
    answer: String(entry.answer ?? "").slice(0, MAX_ANSWER_LENGTH),
  }));

  const problem = describeSetProblem(trimmed);
  if (problem) return { problem };

  const timestamp = nowIso();
  const inserts = await Promise.all(
    trimmed.map(async (entry, index) => {
      const { hash, scheme } = await hashAnswer(env, userId, entry.answer);
      return env.DB.prepare(
        `INSERT INTO user_security_questions
           (id, user_id, question, answer_hash, answer_scheme, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newId(), userId, entry.question, hash, scheme, index, timestamp);
    }),
  );

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM user_security_questions WHERE user_id = ?`).bind(userId),
    ...inserts,
  ]);
  return { problem: null };
}

export async function clearQuestions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM user_security_questions WHERE user_id = ?`)
    .bind(userId)
    .run();
}

/** Length-independent comparison, so a wrong answer takes the same time as a right one. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type QuestionCheck =
  | { ok: true }
  | { ok: false; reason: "none_enrolled" | "incomplete" | "unreadable" | "mismatch" };

/**
 * Checks a full set of answers.
 *
 * Every enrolled question must be answered and every answer must be right. Which ones
 * were wrong is deliberately not reported: telling somebody "two of three correct" turns
 * a set of questions into three independent one-question guesses, which is precisely the
 * weakness that made systems asking two-of-five worth abandoning.
 */
export async function checkAnswers(
  env: Env,
  userId: string,
  submitted: unknown,
): Promise<QuestionCheck> {
  const rows = await loadQuestions(env, userId);
  if (rows.length === 0) return { ok: false, reason: "none_enrolled" };

  if (typeof submitted !== "object" || submitted === null || Array.isArray(submitted)) {
    return { ok: false, reason: "incomplete" };
  }
  const answers = submitted as Record<string, unknown>;

  /*
   * A set stored without a pepper cannot be verified once one is added, and vice versa:
   * the digest would never match. Reported as its own reason so the person is told to
   * enrol again rather than being left to conclude they have forgotten their own
   * answers - the same treatment `openSecret` gives an unreadable TOTP secret.
   */
  const scheme = questionsScheme(env);
  if (rows.some((row) => row.answer_scheme !== scheme)) {
    return { ok: false, reason: "unreadable" };
  }

  // Every answer is hashed and compared even once one has failed, so the time taken says
  // nothing about which question was wrong.
  let allMatched = true;
  for (const row of rows) {
    const given = answers[row.id];
    if (typeof given !== "string" || normaliseAnswer(given) === "") {
      allMatched = false;
      continue;
    }
    const { hash } = await hashAnswer(env, userId, given);
    if (!constantTimeEqual(hash, row.answer_hash)) allMatched = false;
  }

  return allMatched ? { ok: true } : { ok: false, reason: "mismatch" };
}
