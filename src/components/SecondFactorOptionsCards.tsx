/**
 * The two things a person can do to make the second step less of a daily tax: remember
 * this machine, and set questions to answer when the phone is not to hand.
 *
 * Both sit under two-step sign-in on the account screen, and both are hidden entirely
 * when the person has no second factor set up, because neither means anything on its own.
 */

import { useCallback, useEffect, useState } from "react";
import {
  MIN_ANSWER_LENGTH,
  SECRET_QUESTION_COUNT,
  validateQuestions,
} from "@shared/second-factor-options";
import { ApiRequestError, api, type SecretQuestion, type TrustedDevice } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { ErrorBanner, Field, Spinner, TextInput } from "./ui";

// ---------------------------------------------------------------------------
// Remembered devices
// ---------------------------------------------------------------------------

export function TrustedDevicesCard({
  setNotice,
}: {
  setNotice: (message: string) => void;
}) {
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.trustedDevices();
      setDevices(data.devices);
      setEnabled(data.policy.enabled);
      setDays(data.policy.days ?? 30);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load devices.");
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (devices === null) return <Spinner label="Loading remembered devices" />;

  // Nothing to say to a firm that has switched this off and has none left over.
  if (!enabled && devices.length === 0) return null;

  const drop = async (id: string, label: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.forgetDevice(id);
      setDevices(result.devices);
      setNotice(`${label ?? "That device"} will ask for a code next time.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not forget it.");
    } finally {
      setBusy(false);
    }
  };

  const dropAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.forgetAllDevices();
      setDevices(result.devices);
      setNotice("Every device will ask for a code next time, including this one.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not forget them.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="card-title">Devices that skip the code</h2>
        <p className="muted mt-0.5">
          {enabled
            ? `When you sign in you can ask a device not to want a code again for ${days} days. This is the list.`
            : "The firm has switched this off. Anything still listed here will ask for a code."}
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {devices.length === 0 ? (
        <p className="muted">
          No devices are remembered, so every sign-in asks for a code. That is the safest
          state and there is nothing to do here.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">
                    {device.label ?? "A browser"}
                    {device.this_one && (
                      <span className="muted ml-2 text-xs">this one</span>
                    )}
                  </p>
                  <p className="muted text-xs">
                    Last used {formatDateTime(device.last_used_at)}. Stops skipping on{" "}
                    {formatDateTime(device.expires_at)}.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void drop(device.id, device.label)}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void dropAll()}
            >
              Forget all of them
            </button>
            <p className="muted text-xs">
              Do this if a laptop or phone has gone missing. It takes effect at once.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Secret questions
// ---------------------------------------------------------------------------

export function SecretQuestionsCard({
  setNotice,
}: {
  setNotice: (message: string) => void;
}) {
  const [allowed, setAllowed] = useState(false);
  const [existing, setExisting] = useState<SecretQuestion[] | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState(
    Array.from({ length: SECRET_QUESTION_COUNT }, () => ({ question: "", answer: "" })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.secretQuestions();
      setAllowed(data.policy.enabled);
      setExisting(data.questions);
      setSuggestions(data.suggestions);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load questions.");
      setExisting([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (existing === null) return <Spinner label="Loading secret questions" />;
  // The firm has not turned this on. Saying nothing is right: it is not a thing this
  // person can choose to have.
  if (!allowed) return null;

  const startEditing = () => {
    setDrafts(
      Array.from({ length: SECRET_QUESTION_COUNT }, (_, index) => ({
        question: suggestions[index] ?? "",
        answer: "",
      })),
    );
    setEditing(true);
    setError(null);
  };

  const save = async () => {
    // Checked here as well as on the server, so the person is told what is wrong without
    // a round trip. The server check is the one that counts.
    const problem = validateQuestions(drafts);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.setSecretQuestions(drafts);
      setExisting(result.questions);
      setEditing(false);
      setNotice("Your secret questions are set. Nobody can read the answers back, including a Partner.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save them.");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.clearSecretQuestions();
      setExisting(result.questions);
      setNotice("Your secret questions are gone. Sign-in now needs a code.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not remove them.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="card-title">Secret questions</h2>
        <p className="muted mt-0.5">
          Two questions you can answer instead of a code, for when your phone is lost,
          flat or somewhere else.
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/*
        Said plainly rather than buried. Somebody choosing between a code and this ought
        to know that one of them needs a phone in your hand and the other needs a fact,
        and that facts leak in a way phones do not.
      */}
      <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
        This is the weaker way in. A code needs your phone; an answer only needs somebody
        to know a thing about you, and a colleague or a search engine often does.{" "}
        <strong>Answers do not have to be true.</strong> An answer nobody could guess
        beats an honest one, and you are the only person who ever has to reproduce it.
      </p>

      {editing ? (
        <div className="space-y-4">
          {drafts.map((draft, index) => (
            <div key={index} className="space-y-2 rounded-md bg-slate-50 p-3">
              <Field label={`Question ${index + 1}`} required>
                {(id) => (
                  <TextInput
                    id={id}
                    value={draft.question}
                    onChange={(e) =>
                      setDrafts((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, question: e.target.value } : item,
                        ),
                      )
                    }
                    className="input"
                  />
                )}
              </Field>
              <Field
                label={`Answer ${index + 1}`}
                required
                hint={`At least ${MIN_ANSWER_LENGTH} characters. Capitals and extra spaces do not matter.`}
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={draft.answer}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) =>
                      setDrafts((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, answer: e.target.value } : item,
                        ),
                      )
                    }
                    className="input"
                  />
                )}
              </Field>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Saving..." : "Save these questions"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : existing.length === 0 ? (
        <button type="button" className="btn-primary" onClick={startEditing}>
          Set up secret questions
        </button>
      ) : (
        <>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {existing.map((item) => (
              <li key={item.id}>{item.question}</li>
            ))}
          </ul>
          <p className="muted text-xs">
            The answers are not stored, only a one-way hash of them. Nobody can read them
            back, including whoever runs the firm. If you forget them, set them again.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={startEditing}>
              Replace them
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void clear()}
            >
              Remove them
            </button>
          </div>
        </>
      )}
    </section>
  );
}
