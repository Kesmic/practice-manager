/**
 * Saving, replacing and removing security questions.
 *
 * These are a recovery route, not a second way to sign in. The screen says so, because
 * somebody who reads this as "another option" will use it as one, and the whole reason
 * it is tolerable is that it is reached only when the phone cannot be.
 *
 * The screen says plainly that this is the weaker way in, because somebody deciding
 * whether to set it up is the one person in a position to weigh that - and because the
 * alternative, a form that presents it as simply another option, would be the interface
 * making the judgement on their behalf.
 *
 * Nothing here can read an answer back. Saving replaces the whole set: an enrolment is
 * three questions asked together, and editing them one at a time would let a set sit in
 * a state too small to be a factor at all.
 */

import { useCallback, useEffect, useState } from "react";
import {
  MAX_ANSWER_LENGTH,
  MAX_QUESTION_LENGTH,
  MIN_QUESTIONS,
  describeSetProblem,
  normaliseAnswer,
} from "@shared/security-questions";
import { ApiRequestError, api } from "../lib/api";
import { ErrorBanner, Field, Select, Spinner, TextInput } from "./ui";

interface Row {
  question: string;
  answer: string;
}

const CUSTOM = "__custom__";

export function SecurityQuestionsCard({
  onChanged,
  setNotice,
}: {
  onChanged: () => void;
  setNotice: (message: string | null) => void;
}) {
  /*
    Whether the app is set up is read here rather than passed down. It is one indexed
    lookup, and lifting it into the page would couple two cards that otherwise have
    nothing to say to each other.
  */
  const [enrolled, setEnrolled] = useState(false);
  const [state, setState] = useState<{
    allowed: boolean;
    questions: Array<{ id: string; question: string }>;
    suggested: string[];
    min: number;
    max: number;
    answers_keyed: boolean;
  } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [questions, status] = await Promise.all([
        api.securityQuestions(),
        api.twoFactor(),
      ]);
      setState(questions);
      setEnrolled(status.two_factor.enabled);
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!state) return <Spinner label="Loading security questions" />;
  // Nothing to show a firm that does not use them. The setting is a Partner's to change,
  // and an explanation of a feature nobody can reach is just noise on the account screen.
  if (!state.allowed) return null;

  const begin = () => {
    setRows(
      Array.from({ length: MIN_QUESTIONS }, (_, i) => ({
        question: state.suggested[i] ?? "",
        answer: "",
      })),
    );
    setCode("");
    setError(null);
  };

  const problem = rows ? describeSetProblem(rows) : null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rows || problem) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveSecurityQuestions(rows, code);
      setRows(null);
      setCode("");
      setNotice(
        "Your security questions are saved. Any devices you had remembered have been forgotten, so you will be asked for a code on each of them once more.",
      );
      await load();
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save those questions.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.clearSecurityQuestions();
      setNotice("Your security questions have been removed.");
      await load();
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not remove them.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold text-slate-900">
        Security questions <span className="font-normal text-slate-500">(recovery only)</span>
      </h2>
      <p className="muted mt-1">
        A way back in for the day you cannot reach your phone, alongside your recovery
        codes. It is not a second way to sign in: your app stays the way in, and you are
        asked <strong>all</strong> of your questions at once when you use this.
      </p>

      <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
        These are weaker than the app. Answers can often be researched, and a colleague
        may already know some of them, so choose questions whose answers are not on your
        HR record, your CV or anywhere public. Getting in this way tells every Partner,
        and it will not remember your device - only a code from your app does that.
        {!state.answers_keyed && (
          <span className="mt-1 block">
            On this deployment answers are stored without the PASSWORD_PEPPER secret, so a
            leaked database copy could be attacked offline. Setting that secret is worth
            doing before relying on this.
          </span>
        )}
      </p>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {!enrolled ? (
        <p className="mt-4 text-sm text-slate-600">
          Set up the authenticator app first. These are how you get back in when the app
          is out of reach, so there has to be an app to be out of reach of.
        </p>
      ) : rows ? (
        <form onSubmit={save} className="mt-4 space-y-4">
          {rows.map((row, index) => (
            <div key={index} className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
              <Field label={`Question ${index + 1}`} required>
                {(id) => (
                  <Select
                    id={id}
                    value={
                      state.suggested.includes(row.question) ? row.question : CUSTOM
                    }
                    onChange={(e) =>
                      setRows((prev) =>
                        prev!.map((r, i) =>
                          i === index
                            ? { ...r, question: e.target.value === CUSTOM ? "" : e.target.value }
                            : r,
                        ),
                      )
                    }
                  >
                    {state.suggested.map((question) => (
                      <option key={question} value={question}>
                        {question}
                      </option>
                    ))}
                    <option value={CUSTOM}>Write my own question...</option>
                  </Select>
                )}
              </Field>

              {!state.suggested.includes(row.question) && (
                <div className="mt-2">
                  <TextInput
                    maxLength={MAX_QUESTION_LENGTH}
                    placeholder="Your own question"
                    value={row.question}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev!.map((r, i) =>
                          i === index ? { ...r, question: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </div>
              )}

              <div className="mt-2">
                <Field
                  label="Answer"
                  required
                  hint={
                    row.answer
                      ? `Stored and compared as "${normaliseAnswer(row.answer)}" - capitals, accents and punctuation do not matter.`
                      : "Capitals, accents and punctuation are ignored when you sign in."
                  }
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      maxLength={MAX_ANSWER_LENGTH}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={row.answer}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev!.map((r, i) =>
                            i === index ? { ...r, answer: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            {rows.length < state.max && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setRows([...rows, { question: "", answer: "" }])}
              >
                Add another question
              </button>
            )}
            {rows.length > MIN_QUESTIONS && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setRows(rows.slice(0, -1))}
              >
                Remove the last one
              </button>
            )}
          </div>

          <Field
            label="Code from your authenticator app"
            required
            hint="Proves it is you saving these, and not somebody who found your screen unattended."
          >
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            )}
          </Field>

          {problem && <p className="text-xs text-rose-600">{problem}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || Boolean(problem) || !code}
            >
              {busy ? "Saving..." : "Save these questions"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setRows(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : state.questions.length ? (
        <div className="mt-4 space-y-3">
          <ul className="space-y-1 text-sm text-slate-700">
            {state.questions.map((item) => (
              <li key={item.id}>- {item.question}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={begin}>
              Replace these questions
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={remove}
              disabled={busy}
            >
              Remove them
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-secondary mt-4" onClick={begin}>
          Set up security questions
        </button>
      )}
    </section>
  );
}
