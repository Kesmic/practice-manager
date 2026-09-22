/**
 * The proposal, as the business being sold to reads it.
 *
 * Opened from a link in an email. No account, no sign-in, and nothing else of the portal
 * reachable from it: somebody who has agreed to nothing yet should not have to be given
 * a login to read what they are being offered.
 *
 * The page renders the same document the firm would print, in a frame, so that what they
 * read on screen and what they forward to their accountant are one file rather than two
 * that might differ. Under it are the only two things they can do: say yes, or say no.
 *
 * Saying yes is not a signature. The page says so plainly, because a button that looked
 * like a contract would be the worst kind of misunderstanding to have with a client on
 * their first day.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { renderProposal, type ProposalDocument } from "@shared/proposal-document";
import { ApiRequestError, api } from "../lib/api";
import { ErrorBanner, Spinner, SuccessBanner, TextArea } from "../components/ui";

export function ProposalView() {
  const { token = "" } = useParams();
  const [data, setData] = useState<{
    reference: string;
    status: string;
    document: ProposalDocument;
  } | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [height, setHeight] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(await api.readProposal(token));
    } catch (err) {
      setDead(
        err instanceof ApiRequestError
          ? err.message
          : "This link is not valid. Please ask for a new one.",
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (dead) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-4">
        <div className="max-w-sm text-center">
          <h1 className="section-title">That link is no longer open</h1>
          <p className="muted mt-2">{dead}</p>
        </div>
      </div>
    );
  }
  if (!data) return <Spinner label="Opening your proposal" />;

  const decide = async (decision: "accepted" | "declined") => {
    setBusy(true);
    setError(null);
    try {
      await api.decideProposal(token, decision, reason.trim() || undefined);
      setDone(
        decision === "accepted"
          ? "Thank you. We will send the engagement letter across - nothing is binding until that is signed."
          : "Thank you for letting us know. Nothing further will happen.",
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not record that.");
    } finally {
      setBusy(false);
    }
  };

  const decided = data.status !== "sent";

  return (
    <div className="min-h-screen bg-page pb-12">
      {/*
        srcDoc rather than a fetch into the page. The document carries its own styles and
        is written to be printed, and rendering it in a frame means what is on screen is
        byte for byte what gets forwarded.

        Grown to fit what it contains, so the page scrolls once. A frame with its own
        scrollbar inside a page that also scrolls is the thing people give up on, and on
        a phone it is close to unusable.
      */}
      <iframe
        title={`Pricing proposal ${data.reference}`}
        className="w-full border-0 bg-white"
        style={{ height: height ? `${height}px` : "85vh" }}
        srcDoc={renderProposal(data.document)}
        onLoad={(event) => {
          const frame = event.currentTarget;
          const measure = () => {
            const body = frame.contentDocument?.body;
            if (body) setHeight(body.scrollHeight + 24);
          };
          measure();
          // Again once the fonts have settled, which changes the height under it.
          window.setTimeout(measure, 200);
        }}
      />

      <div className="mx-auto mt-6 max-w-2xl px-4">
        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {done && <SuccessBanner message={done} />}

        {!decided && !done && (
          <div className="card p-5">
            <h2 className="card-title">What would you like to do?</h2>
            <p className="muted mt-1">
              Saying yes is not a signature and does not commit you to anything. It tells
              us to prepare the engagement letter, which is the document you would sign.
            </p>

            {declining ? (
              <div className="mt-4 space-y-3">
                <TextArea
                  rows={3}
                  aria-label="Anything you would like to tell us"
                  placeholder="Anything you would like to tell us - it is helpful, and optional."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => void decide("declined")}
                  >
                    Send it
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setDeclining(false)}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void decide("accepted")}
                >
                  Yes, let us go ahead
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setDeclining(true)}
                >
                  Not for us
                </button>
                <a
                  className="btn-ghost"
                  href={`/api/proposals/${encodeURIComponent(token)}/document`}
                >
                  Download a copy
                </a>
              </div>
            )}
          </div>
        )}

        {decided && !done && (
          <div className="card p-5 text-center">
            <p className="muted">
              {data.status === "accepted"
                ? "You have accepted this proposal. We will be in touch with the engagement letter."
                : data.status === "declined"
                  ? "This proposal was declined. If that was a mistake, tell whoever sent it to you."
                  : "This proposal has been withdrawn."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
