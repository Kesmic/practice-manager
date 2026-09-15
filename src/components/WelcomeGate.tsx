/**
 * The Managing Director's welcome, full screen, before anything is asked.
 *
 * A new joiner's first sight of the portal was a form with fifteen required fields on
 * it. Everything they needed in order to feel welcomed was on the same page, below the
 * fold, after the thing demanding their bank details. The firm asked for the order to be
 * the other way round, which is obviously right: somebody's first morning should open
 * with being welcomed, not with being processed.
 *
 * So this takes the whole screen, holds nothing but the letter, and has one button.
 *
 * **Shown once.** It is a welcome, not a gate - a screen that reappeared on every visit
 * would become something to click past, which is the opposite of reading it. Once
 * dismissed it stays dismissed, and the letter keeps its usual place further down the
 * onboarding page for anyone who wants to read it again.
 *
 * **Remembered per person, in this browser.** localStorage rather than the server,
 * because "have you seen the welcome" is not a fact the firm needs a record of, and a
 * column for it would be a migration and an endpoint for something nobody will ever
 * query. The cost of the browser forgetting is that somebody sees a warm letter twice.
 * Every read and write is wrapped, because a private window can refuse both.
 */

import { useState } from "react";
import { WelcomeCard } from "./WelcomeCard";

/** Keyed by person, so a shared machine does not hide it from the next joiner. */
function storageKey(userId: string): string {
  return `kpm_welcome_seen_${userId}`;
}

function alreadySeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) === "1";
  } catch {
    // A private window, or storage the browser has blocked. Showing it is the right
    // failure: a welcome shown twice is better than one never shown.
    return false;
  }
}

function remember(userId: string): void {
  try {
    window.localStorage.setItem(storageKey(userId), "1");
  } catch {
    // Nothing to do. They see it again next time, which is harmless.
  }
}

export function WelcomeGate({
  userId,
  body,
  firmName,
  mdName,
  mdTitle,
  /** Only held over somebody who has not finished their first sign-in. */
  active,
}: {
  userId: string;
  body: string;
  firmName: string;
  mdName: string;
  mdTitle: string;
  active: boolean;
}) {
  const [dismissed, setDismissed] = useState(() => alreadySeen(userId));

  // Nothing to show where the firm has not written a welcome, or where this person is
  // past their first sign-in and is simply visiting the page.
  if (!active || dismissed || !body.trim()) return null;

  const close = () => {
    remember(userId);
    setDismissed(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-page"
      role="dialog"
      aria-modal="true"
      aria-label={`Welcome to ${firmName}`}
    >
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-4 py-10">
        <WelcomeCard
          variant="letter"
          body={body}
          firmName={firmName}
          mdName={mdName}
          mdTitle={mdTitle}
        />

        <div className="mt-6 flex flex-col items-center gap-2">
          <button type="button" className="btn-primary px-6" onClick={close}>
            Continue
          </button>
          {/*
            Said plainly, so pressing Continue does not feel like dismissing something
            they might need again.
          */}
          <p className="hint text-center">
            This stays on your onboarding page if you want to read it again.
          </p>
        </div>
      </div>
    </div>
  );
}
