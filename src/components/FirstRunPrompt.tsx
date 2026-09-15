/**
 * The banner at the top of whichever screen a new joiner has been sent to.
 *
 * The route guard moves somebody to the page that lets them finish their current step.
 * Arriving there without being told why is disorienting - particularly for the password
 * step, where somebody who has just filled in twenty fields finds themselves on the
 * account screen with no explanation of what happened to their onboarding.
 *
 * So this says which step they are on, how many there are, and what this one is for.
 */

import {
  FIRST_RUN_PROMPTS,
  FIRST_RUN_STEPS,
  stepNumber,
  type FirstRunStep,
} from "@shared/first-run";

export function FirstRunPrompt({ step }: { step: FirstRunStep | null }) {
  if (!step) return null;
  const prompt = FIRST_RUN_PROMPTS[step];

  return (
    <section className="rounded-lg bg-brand-700 px-5 py-4 text-white">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
        Step {stepNumber(step)} of {FIRST_RUN_STEPS.length}
      </p>
      <h2 className="mt-1 text-lg font-semibold">{prompt.title}</h2>
      <p className="mt-1 text-sm text-white/85">{prompt.detail}</p>

      {/*
        A plain row of dots rather than a progress bar. Three steps is not enough to
        need a percentage, and "33%" on somebody's first morning reads as a measure of
        how much of them the firm has processed.
      */}
      <ol className="mt-3 flex gap-1.5" aria-label="Your first sign-in">
        {FIRST_RUN_STEPS.map((key) => (
          <li
            key={key}
            aria-current={key === step ? "step" : undefined}
            className={`h-1.5 flex-1 rounded-full ${
              stepNumber(key) < stepNumber(step)
                ? "bg-white"
                : key === step
                  ? "bg-white/70"
                  : "bg-white/25"
            }`}
          />
        ))}
      </ol>
    </section>
  );
}
