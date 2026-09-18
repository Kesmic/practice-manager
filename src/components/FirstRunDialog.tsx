/**
 * The two first-run steps that are asked over the onboarding page rather than on it.
 *
 * Choosing a password and setting up two-step sign-in used to happen on the account
 * screen, which made the first sign-in feel like three unrelated errands: fill in a
 * long form here, now go somewhere else, now you are finished but nothing says so. The
 * worst of it was the end - once the last step was done there was no step left to route
 * anybody anywhere, so they were simply left on the account screen.
 *
 * So both are asked here, over the checklist that sets out the order, and the dialog
 * closes itself. Nothing closes it on success: the step it is showing comes from the
 * session, completing the step advances the session, and a dialog with no step to show
 * is not rendered. The next step opens in its place, and after the last one the person
 * is looking at their onboarding with everything ticked.
 *
 * It can be dismissed. The server still confines somebody who has not finished - they
 * will not get far - but a dialog that cannot be closed is a dialog somebody can be
 * stuck behind, and this portal has been there once already. Dismissing it leaves the
 * prompt on the page with a button to pick it back up.
 */

import { FIRST_RUN_PROMPTS, stepNumber, FIRST_RUN_STEPS, type FirstRunStep } from "@shared/first-run";
import { Modal } from "./ui";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { TwoFactorCard } from "./TwoFactorCard";

export function FirstRunDialog({
  step,
  open,
  onDismiss,
  onDone,
  setNotice,
}: {
  step: FirstRunStep | null;
  open: boolean;
  onDismiss: () => void;
  /** Refreshes the session, which is what advances the step and closes this. */
  onDone: () => Promise<void> | void;
  setNotice: (message: string | null) => void;
}) {
  // The onboarding step is the page itself, not a dialog over it.
  if (!step || step === "onboarding") return null;

  const prompt = FIRST_RUN_PROMPTS[step];

  return (
    <Modal
      open={open}
      title={prompt.title}
      onClose={onDismiss}
      wide={step === "two_factor"}
    >
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Step {stepNumber(step)} of {FIRST_RUN_STEPS.length}
        </p>
        <p className="text-sm text-slate-600">{prompt.detail}</p>

        {step === "password" ? (
          <ChangePasswordForm
            framed={false}
            submitLabel="Set my password"
            /*
             * No success message. The dialog disappearing and the next step opening is
             * the confirmation, and a banner announcing success inside a panel that is
             * about to unmount reads as a flicker.
             */
            successMessage={null}
            onChanged={onDone}
          />
        ) : (
          <TwoFactorCard setNotice={setNotice} onChanged={() => void onDone()} />
        )}
      </div>
    </Modal>
  );
}
