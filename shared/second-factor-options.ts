/**
 * Two ways to make the second step less of a daily tax, and what each of them costs.
 *
 * Both exist because a second factor that is merely correct gets switched off. The
 * question each answers is different, though, and so is the honest answer.
 *
 * **Remembering a device** costs almost nothing. The factor is still a phone: it was
 * presented, and what is stored afterwards is a random token that proves this browser
 * already did it. Someone who steals the token gets what they would have got by stealing
 * a live session cookie, which is a risk that already exists and is already bounded.
 *
 * **Secret questions** cost a great deal, and this file is where that is written down
 * rather than left for somebody to discover. A code needs the phone in your hand. An
 * answer needs a fact, and facts about the partners of a firm whose people are named on
 * its own website are often available to a stranger with a search engine and nearly
 * always available to a colleague. Worse, a fact cannot be taken back: a compromised
 * phone is replaced in an afternoon, while the town you were born in is compromised for
 * ever.
 *
 * So the questions are offered, because the firm asked for them and it is their risk to
 * take, but with the things that make them defensible rather than ornamental: the person
 * writes their own questions instead of picking from a list every attacker also has, both
 * answers must be right, the answers are hashed and never shown back, the sign-in attempt
 * limit applies to them exactly as it does to codes, and a Partner can switch the whole
 * route off for the firm.
 */

// ---------------------------------------------------------------------------
// Remembering a device
// ---------------------------------------------------------------------------

/** How long a remembered device may skip the second step. */
export const TRUSTED_DEVICE_DAYS = 30;

/**
 * The longest a firm may set it to.
 *
 * Ninety days rather than "no limit". A remembered device is the one part of this that
 * cannot be revoked by the person losing the laptop, only by somebody signing in
 * somewhere else and saying so, and an indefinite one is not a second factor with a
 * convenience on top, it is a second factor you did once.
 */
export const TRUSTED_DEVICE_MAX_DAYS = 90;
export const TRUSTED_DEVICE_MIN_DAYS = 1;

/** What the settings screen offers. */
export const TRUSTED_DEVICE_DAY_CHOICES = [7, 14, 30, 60, 90] as const;

export const TRUSTED_DEVICES_OFF = "off";

export type TrustedDevicePolicy =
  | { enabled: false }
  | { enabled: true; days: number };

export function clampTrustedDays(days: number): number {
  return Math.min(
    Math.max(Math.round(days), TRUSTED_DEVICE_MIN_DAYS),
    TRUSTED_DEVICE_MAX_DAYS,
  );
}

/**
 * Reads the stored setting.
 *
 * Absent means on, at thirty days, because that is what was asked for and because the
 * thing it skips has already been done once on that device. This is the opposite of the
 * two-factor policy's default and for the same reason the idle timeout differs from it:
 * what matters is what the setting does when nobody has thought about it, and an
 * unconsidered "remember this device" offer costs a person one unticked box.
 */
export function readTrustedDevicePolicy(
  raw: string | null | undefined,
): TrustedDevicePolicy {
  const value = (raw ?? "").trim();
  if (value === TRUSTED_DEVICES_OFF) return { enabled: false };
  if (value === "") return { enabled: true, days: TRUSTED_DEVICE_DAYS };

  const days = Number.parseInt(value, 10);
  if (!Number.isFinite(days)) return { enabled: true, days: TRUSTED_DEVICE_DAYS };
  return { enabled: true, days: clampTrustedDays(days) };
}

export function writeTrustedDevicePolicy(policy: TrustedDevicePolicy): string {
  return policy.enabled ? String(clampTrustedDays(policy.days)) : TRUSTED_DEVICES_OFF;
}

// ---------------------------------------------------------------------------
// Secret questions
// ---------------------------------------------------------------------------

/** How many questions must be set, and how many must be answered to sign in. */
export const SECRET_QUESTION_COUNT = 2;

/**
 * The shortest answer worth storing.
 *
 * Four characters. Short enough not to refuse a real answer like "Kofi", long enough to
 * turn away a single letter, which against two questions and five attempts would be a
 * genuine chance rather than a theoretical one.
 */
export const MIN_ANSWER_LENGTH = 4;

/** The shortest question that is actually a question. */
export const MIN_QUESTION_LENGTH = 8;

export const MAX_QUESTION_LENGTH = 200;
export const MAX_ANSWER_LENGTH = 200;

/**
 * Prompts, not a menu.
 *
 * These are shown as examples the person edits, and none of them asks for a fact that
 * appears on a passport or an application form. "Mother's maiden name" and "the school
 * you went to" are absent deliberately: they are the ones on every stock list, which
 * means they are the ones on every leaked stock list, and for a firm whose partners are
 * named on its own website they are close to public.
 *
 * The advice that matters is underneath them on the screen: an answer nobody else knows
 * beats an answer that is true.
 */
export const QUESTION_SUGGESTIONS = [
  "What did you want to be when you were ten?",
  "Which meal would you cook to impress somebody?",
  "What is the first thing you would buy with an unexpected windfall?",
  "Which song do you know every word of?",
  "What did you name your first car, bicycle or phone?",
  "Which place do you think of when you want to be somewhere else?",
] as const;

/**
 * Folds away everything that varies between two honest typings of the same answer.
 *
 * Case, outer space, runs of inner space, and the accents somebody types on a phone but
 * not on a laptop. This is deliberately generous: an answer refused because it was typed
 * with a capital letter is indistinguishable, to the person, from an answer that is
 * simply forgotten, and the cost of that mistake is a locked-out partner.
 *
 * Punctuation is kept. Removing it would fold "St. John's" and "St Johns" together,
 * which is helpful, but would also fold answers a person chose to distinguish, and the
 * accent and case rules already cover the mistakes people actually make.
 */
export function normaliseAnswer(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normaliseQuestion(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

export interface QuestionDraft {
  question: string;
  answer: string;
}

/**
 * Checks a proposed set before anything is stored.
 *
 * Returns the first problem in words the person can act on, or null. The two-distinct
 * rules are the ones worth having: two identical questions is one question, and two
 * identical answers means whoever guesses one has both, which turns the pair back into a
 * single factor while looking like two.
 */
export function validateQuestions(drafts: QuestionDraft[]): string | null {
  if (drafts.length !== SECRET_QUESTION_COUNT) {
    return `Set exactly ${SECRET_QUESTION_COUNT} questions.`;
  }

  const questions: string[] = [];
  const answers: string[] = [];

  for (const draft of drafts) {
    const question = normaliseQuestion(draft.question);
    const answer = normaliseAnswer(draft.answer);

    if (question.length < MIN_QUESTION_LENGTH) {
      return "Each question needs to be a real question, at least a few words long.";
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return "That question is too long.";
    }
    if (answer.length < MIN_ANSWER_LENGTH) {
      return `Each answer needs at least ${MIN_ANSWER_LENGTH} characters.`;
    }
    if (typeof draft.answer === "string" && draft.answer.length > MAX_ANSWER_LENGTH) {
      return "That answer is too long.";
    }
    // An answer sitting inside its own question is not a secret.
    if (question.toLowerCase().includes(answer)) {
      return "One of your answers appears in its own question. Anybody reading the question would have it.";
    }

    questions.push(question.toLowerCase());
    answers.push(answer);
  }

  if (questions[0] === questions[1]) {
    return "Use two different questions.";
  }
  if (answers[0] === answers[1]) {
    return "Use two different answers. Two the same is one secret, not two.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Whether the firm allows the questions at all
// ---------------------------------------------------------------------------

export type SecretQuestionPolicy = { enabled: boolean };

/**
 * Absent means off.
 *
 * The opposite default to remembering a device, and for the reason set out at the top of
 * this file: this route is weaker than the one it stands in for. A firm that has never
 * heard of it should not find their partners able to reach the client files by naming a
 * childhood pet. Turning it on is a decision somebody makes on purpose.
 */
export function readSecretQuestionPolicy(
  raw: string | null | undefined,
): SecretQuestionPolicy {
  return { enabled: (raw ?? "").trim() === "on" };
}

export function writeSecretQuestionPolicy(policy: SecretQuestionPolicy): string {
  return policy.enabled ? "on" : "off";
}
