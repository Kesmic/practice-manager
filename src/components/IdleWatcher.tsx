/**
 * Watches for a screen left unattended, warns, then signs out.
 *
 * The Worker enforces the same window and is the authority: this cannot be the only
 * guard, because a browser tab that was closed without signing out never runs it again.
 * What this adds is the two things the server cannot do. It knows when somebody last
 * actually touched the machine, rather than when a request last happened; and it can warn
 * before the deadline instead of announcing the fact afterwards.
 *
 * The warning is not a courtesy. Somebody reading a long policy without touching anything
 * loses their place; somebody part-way through a review point loses the review point. A
 * countdown with a button costs one click and avoids both.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IDLE_WARNING_SECONDS } from "@shared/session-policy";
import { useSession } from "../lib/auth";
import { api } from "../lib/api";

/** Interactions that count as somebody being there. */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

export function IdleWatcher() {
  const { user, idlePolicy, signOut } = useSession();
  const navigate = useNavigate();

  /*
    The last interaction, in a ref rather than state on purpose: it changes on every
    keystroke, and re-rendering the whole application on each one would be a worse
    problem than the one being solved.
  */
  const lastActive = useRef(Date.now());
  const [secondsLeft, secondsLeftSet] = useState<number | null>(null);
  const signingOut = useRef(false);

  /*
    When the Worker was last told somebody is here.

    The two halves measure different things: this component watches for a hand on the
    machine, while the Worker can only see requests. Reading counts as activity here and
    does not there, so somebody scrolling through a long file for ten minutes would keep
    resetting the page's timer, see no warning at all, and then be signed out the moment
    they finally clicked something. Present the whole time, warned about none of it.

    So genuine interaction, and only genuine interaction, occasionally tells the Worker.
    A session nobody is touching still sends nothing, which is what keeps the server side
    honest: a quiet session really is a quiet person.
  */
  const lastPinged = useRef(Date.now());

  const enabled = Boolean(user) && idlePolicy?.enabled === true;
  const windowMs = (idlePolicy?.enabled ? idlePolicy.minutes : 0) * 60_000;

  /*
    The warning cannot be longer than a third of the window. Ninety seconds of warning on
    a ten-minute window is right; ninety seconds on a two-minute window means the dialog is
    up for most of the session, and pressing Stay signed in puts it straight back, because
    the reset lands inside the warning period again.
  */
  const warningSeconds = Math.max(
    5,
    Math.min(IDLE_WARNING_SECONDS, Math.floor(windowMs / 3000)),
  );

  const stayIn = useCallback(() => {
    lastActive.current = Date.now();
    lastPinged.current = Date.now();
    secondsLeftSet(null);
    // One request, which also refreshes the last-used time the Worker measures against.
    void api.session().catch(() => undefined);
  }, []);

  // Record interaction. Passive listeners, and no state written, so this is cheap enough
  // to sit on every scroll and keystroke in the application.
  useEffect(() => {
    if (!enabled) return;
    const note = () => {
      lastActive.current = Date.now();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, note, { passive: true });
    }
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, note);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      secondsLeftSet(null);
      return;
    }

    const tick = window.setInterval(() => {
      const now = Date.now();
      const idleFor = now - lastActive.current;
      const remaining = Math.ceil((windowMs - idleFor) / 1000);

      /*
        Keep the Worker's clock in step with this one, but only on the back of real
        interaction. Half the window, so the Worker's view can never be more than half a
        window stale while somebody is here, and at most two requests per window rather
        than one per second.
      */
      if (
        remaining > 0 &&
        lastActive.current > lastPinged.current &&
        now - lastPinged.current > windowMs / 2
      ) {
        lastPinged.current = now;
        void api.session().catch(() => undefined);
      }

      if (remaining <= 0) {
        if (signingOut.current) return;
        signingOut.current = true;
        void signOut().finally(() => {
          navigate("/login?reason=idle", { replace: true });
          signingOut.current = false;
        });
        return;
      }

      secondsLeftSet(remaining <= warningSeconds ? remaining : null);
    }, 1000);

    return () => window.clearInterval(tick);
  }, [enabled, windowMs, warningSeconds, signOut, navigate]);

  if (!enabled || secondsLeft === null) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-md rounded-lg bg-panel p-5 shadow-xl ring-1 ring-slate-200">
        <h2 id="idle-title" className="text-base font-semibold text-slate-900">
          Still there?
        </h2>
        <p className="muted mt-1">
          You will be signed out in{" "}
          <strong className="tabular-nums text-slate-800">
            {minutes > 0 ? `${minutes}m ` : ""}
            {seconds}s
          </strong>{" "}
          because the portal has been idle. This firm signs sessions out after a spell of
          inactivity, so a screen left open cannot be used by somebody else.
        </p>
        <p className="muted mt-2">
          Anything you have typed and not saved will be lost, so if you were part-way
          through something, stay signed in and save it.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={stayIn} autoFocus>
            Stay signed in
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              signingOut.current = true;
              void signOut().finally(() => {
                navigate("/login", { replace: true });
                signingOut.current = false;
              });
            }}
          >
            Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}
