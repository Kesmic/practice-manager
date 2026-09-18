/**
 * What a new joiner has to finish before the portal opens up, and in which order.
 *
 * Three gates, and the order is the firm's decision rather than a technical one:
 *
 *   1. **Their onboarding** - the details the firm cannot proceed without.
 *   2. **A password of their own**, replacing the temporary one they were emailed.
 *   3. **Two-step sign-in**, where their grade requires it.
 *
 * Onboarding first because that is what a new joiner should meet on their first
 * morning. Being dropped straight onto a password form, before anything has explained
 * what the portal is or what is coming, tells somebody nothing about the firm they have
 * joined. The onboarding page does: the welcome, the five stages, the dates, and what is
 * theirs to do.
 *
 * ---
 *
 * It is worth being plain about what this does and does not cost, because the obvious
 * worry is that it leaves a temporary password usable for longer.
 *
 * It does. But a temporary password that reaches the portal at all is already an account
 * takeover waiting to happen, in either order: somebody holding it can sign in and set a
 * password of their own, which locks the real joiner out and gives the holder the
 * account. Putting the password step first does not prevent that - it is the first thing
 * such a person would do. So the ordering changes what a *legitimate* new joiner does
 * first, and not much else. The protection that matters is the one already in place:
 * confinement. On any of these three gates the person reaches their own account screen
 * and their own onboarding, and nothing else - no client work, no colleague's record.
 *
 * ---
 *
 * Held here rather than in the Worker because both sides need it and they must not
 * disagree. The server decides what a request may reach; the browser decides where to
 * send somebody. A browser that routes to the password screen while the server is still
 * demanding onboarding is a loop the person cannot get out of.
 */

export const FIRST_RUN_STEPS = ["onboarding", "password", "two_factor"] as const;
export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];

/** What is outstanding, as the session reports it. */
export interface FirstRunState {
  /** Every field the first sign-in asks for has been given. */
  onboarding_done: boolean;
  /** They have replaced the temporary password they were issued. */
  password_set: boolean;
  /**
   * Either their grade does not require two-step sign-in, or it does and they have set
   * it up. False only for somebody who is obliged and has not.
   */
  two_factor_ready: boolean;
}

/**
 * The next thing standing between this person and the rest of the portal, or null.
 *
 * One step at a time, in order. Reporting all three at once would be accurate and
 * useless: somebody on their first morning needs to know what to do next, not the size
 * of the queue.
 */
export function nextFirstRunStep(state: FirstRunState): FirstRunStep | null {
  if (!state.onboarding_done) return "onboarding";
  if (!state.password_set) return "password";
  if (!state.two_factor_ready) return "two_factor";
  return null;
}

/**
 * Where the browser should send somebody who still owes this step.
 *
 * All three go to the same place, which is the point. The onboarding page is where the
 * firm sets out what a new joiner has to do and in what order, so it is the one screen
 * that can show them where they are in it; the password and two-step steps are asked
 * there, over it, rather than on a different screen.
 *
 * It used to send the last two to the account screen. That made the first run feel like
 * three unrelated errands - and worse, finishing the last one left somebody sitting on
 * the account screen with nothing telling them they were done or where to go next,
 * because there was no step left to route them anywhere.
 */
export function firstRunDestination(_step: FirstRunStep): string {
  return "/onboarding";
}

/** What the server says when a request is refused for this step. */
export const FIRST_RUN_MESSAGES: Record<FirstRunStep, string> = {
  onboarding:
    "There are a few details the firm needs before you can go further. Finish them on your onboarding page.",
  password:
    "You are signed in with a temporary password. Set a new password before continuing.",
  two_factor:
    "Two-step sign-in is required at your grade. Set it up under My account before continuing.",
};

/** What the screen says at the top of the page it has sent them to. */
export const FIRST_RUN_PROMPTS: Record<FirstRunStep, { title: string; detail: string }> = {
  onboarding: {
    title: "Let us get you set up",
    detail:
      "A few things the firm needs from you before you can get to work. It is asked once, and all of it is required.",
  },
  password: {
    title: "Now choose your own password",
    detail:
      "Your details are in. The password you were emailed is temporary - replace it and the portal opens up.",
  },
  two_factor: {
    title: "One last thing: two-step sign-in",
    detail:
      "Your grade requires a code from your phone as well as your password. Set it up below and you are finished.",
  },
};

/** The step's place in the sequence, for a "step 2 of 3" line. */
export function stepNumber(step: FirstRunStep): number {
  return FIRST_RUN_STEPS.indexOf(step) + 1;
}
