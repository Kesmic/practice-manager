/**
 * Security questions as an alternative second factor.
 *
 * ## Read this before switching it on
 *
 * Security questions are a weaker factor than an authenticator app, and not by a small
 * margin. NIST SP 800-63B stopped recognising them as an authenticator at all, for
 * reasons that apply squarely to a firm of this size: the answers are researchable
 * (a mother's maiden name, a first school), they are reused across every site that asks,
 * and in a small practice a colleague frequently knows them already. An authenticator
 * app asks "do you have the phone"; a question asks "do you know a fact about this
 * person", and those are not the same question.
 *
 * So the capability is here, because a firm is entitled to decide its own trade-off
 * between a locked-out partner and a researchable factor, but three things hold:
 *
 * **Off unless the firm turns it on.** Same reasoning as the two-factor policy in
 * `twofactor.ts`: an absent setting means off. A migration does not make this decision
 * on the firm's behalf.
 *
 * **Every question, not a sample.** Some systems ask two of five, which means an
 * attacker retries until they are asked the two they know. Enrolment takes at least
 * three questions and sign-in asks for all of them at once.
 *
 * **Signing in this way is announced.** The person and the firm's partners get an inbox
 * entry saying the account was reached with questions rather than a code. A factor that
 * can be researched should not be usable in silence.
 */

/** Whether the firm permits questions to stand in for a code. */
export const SECURITY_QUESTIONS_ON = "on";
export const SECURITY_QUESTIONS_OFF = "off";

export type SecurityQuestionsPolicy =
  | typeof SECURITY_QUESTIONS_ON
  | typeof SECURITY_QUESTIONS_OFF;

/**
 * The stored setting, read defensively.
 *
 * Absent means off, and so does anything unparseable. The only thing that writes here is
 * a validating endpoint, so a value that will not parse means the row is damaged - and a
 * damaged row is not consent to weaken how people sign in.
 */
export function readQuestionsPolicy(
  raw: string | null | undefined,
): SecurityQuestionsPolicy {
  return (raw ?? "").trim() === SECURITY_QUESTIONS_ON
    ? SECURITY_QUESTIONS_ON
    : SECURITY_QUESTIONS_OFF;
}

export function questionsEnabled(policy: SecurityQuestionsPolicy): boolean {
  return policy === SECURITY_QUESTIONS_ON;
}

/**
 * How many questions an enrolment holds.
 *
 * Three is the floor because all of them are asked at once: two would put an attacker
 * who has researched a person within reach of the account, and five is where filling the
 * form stops being something anybody completes honestly rather than typing "x" three
 * times.
 */
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 5;

export const MAX_QUESTION_LENGTH = 160;
export const MAX_ANSWER_LENGTH = 120;

/**
 * The shortest answer that will be accepted, measured after normalisation.
 *
 * Four characters. Short enough not to rule out a real answer ("Ford", "Kofi"), long
 * enough to refuse the single letter somebody types to get past the form - which is the
 * failure this actually guards against, since an enrolment nobody took seriously is
 * worse than none at all.
 */
export const MIN_ANSWER_LENGTH = 4;

/**
 * Questions offered as a starting point. The person may write their own instead.
 *
 * Chosen to be things that do not appear on an identity document, a CV or a LinkedIn
 * profile, and that do not change. Deliberately absent: mother's maiden name (public
 * record in many jurisdictions), date of birth and school (both on the HR record this
 * very portal holds), and anything a colleague would learn in a week in the office.
 */
export const SUGGESTED_QUESTIONS: readonly string[] = [
  "What was the first meal you learned to cook for yourself?",
  "What was the name of the street you lived on when you were ten?",
  "What is the title of the first book you remember finishing?",
  "What was the make and model of your first vehicle?",
  "Who was the teacher you disliked most, and what did they teach?",
  "What was the name of a childhood pet nobody outside your family would know?",
  "Where did you go on your first journey outside the country?",
  "What was your first employer, before the career you have now?",
];

/**
 * Reduces an answer to what is actually compared.
 *
 * Somebody enrolling types "St. Mary's Road" and, eighteen months later, "st marys
 * road". Both are the same answer and refusing the second one would be the system
 * failing, not the person. So case, accents, punctuation and repeated spaces all come
 * out, and what is left is compared.
 *
 * The cost is a slightly smaller answer space, which matters less than it sounds: the
 * answers were never high-entropy, which is the whole reason this factor is off by
 * default and announced when used.
 *
 * Shared by the browser and the Worker so that what the enrolment form tells somebody
 * their answer normalises to is exactly what the server will store.
 */
export function normaliseAnswer(value: string): string {
  return value
    .normalize("NFKD")
    // Strip combining marks, so "Kofí" and "Kofi" match. Written as an explicit
    // escape rather than a literal range, which an editor can silently mangle.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether a normalised answer is long enough to be worth storing. */
export function answerIsUsable(value: string): boolean {
  return normaliseAnswer(value).length >= MIN_ANSWER_LENGTH;
}

/**
 * What is wrong with a proposed set, or null if nothing is.
 *
 * Written as one function returning a sentence rather than as thrown errors, so the
 * enrolment form can show the same words the server would, before the person submits.
 */
export function describeSetProblem(
  entries: Array<{ question: string; answer: string }>,
): string | null {
  if (entries.length < MIN_QUESTIONS) {
    return `Choose at least ${MIN_QUESTIONS} questions. You will be asked all of them at once.`;
  }
  if (entries.length > MAX_QUESTIONS) {
    return `That is more than ${MAX_QUESTIONS} questions.`;
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    const question = entry.question.trim();
    if (!question) return "Every question needs some text.";
    if (question.length > MAX_QUESTION_LENGTH) {
      return `A question must be ${MAX_QUESTION_LENGTH} characters or fewer.`;
    }
    const key = question.toLowerCase();
    if (seen.has(key)) return "Each question can only be used once.";
    seen.add(key);

    if (entry.answer.length > MAX_ANSWER_LENGTH) {
      return `An answer must be ${MAX_ANSWER_LENGTH} characters or fewer.`;
    }
    if (!answerIsUsable(entry.answer)) {
      return `Every answer needs at least ${MIN_ANSWER_LENGTH} letters or digits. Single characters are not enough to be a factor.`;
    }
    if (normaliseAnswer(entry.answer) === normaliseAnswer(question)) {
      return "An answer cannot simply repeat its question.";
    }
  }

  // Distinct questions with one shared answer is the same single secret three times.
  const answers = new Set(entries.map((entry) => normaliseAnswer(entry.answer)));
  if (answers.size !== entries.length) {
    return "Give a different answer to each question - repeating one answer makes them a single secret.";
  }

  return null;
}
