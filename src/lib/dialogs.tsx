/**
 * Asking the person a question, in a dialog of our own.
 *
 * `window.prompt` and `window.confirm` looked like the cheap way to ask "why?" before
 * an action. They are not: an installed app (the portal is one, on phones and desks)
 * has them suppressed by the browser, so the question was never shown and the click
 * did nothing. Ending a discount, cancelling an invoice, quoting a fee - all of them
 * silently refused on a phone.
 *
 * So the app has its own. Three questions cover every use: ask for a line of text,
 * ask yes or no, and show something (a link to hand over). Each returns a promise, so a
 * handler reads the way the old one did - `const reason = await ask(...)` - and a
 * cancelled dialog resolves to null or false rather than throwing.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "../components/ui";

export interface AskOptions {
  title?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** A reason wants room; a number does not. */
  multiline?: boolean;
  inputMode?: "text" | "decimal" | "numeric";
  /** Whether an empty answer is refused. Default: it is. */
  required?: boolean;
  /** The confirm button reads as a warning. */
  danger?: boolean;
}

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export interface ShowOptions {
  title?: string;
  /** A link to hand over, shown with a copy button. */
  link?: string;
}

interface Dialogs {
  /** A line of text, or null if they cancelled. */
  ask: (question: string, options?: AskOptions) => Promise<string | null>;
  /** Yes or no. */
  confirm: (question: string, options?: ConfirmOptions) => Promise<boolean>;
  /** Something to read, resolved when closed. */
  show: (message: string, options?: ShowOptions) => Promise<void>;
}

type Pending =
  | { kind: "ask"; question: string; options: AskOptions; resolve: (v: string | null) => void }
  | { kind: "confirm"; question: string; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "show"; message: string; options: ShowOptions; resolve: () => void };

const DialogsContext = createContext<Dialogs | null>(null);

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!pending) return;
    setAnswer(pending.kind === "ask" ? (pending.options.initial ?? "") : "");
    setCopied(false);
    // After the modal has taken focus, move it into the field.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [pending]);

  const ask = useCallback<Dialogs["ask"]>(
    (question, options = {}) =>
      new Promise((resolve) => setPending({ kind: "ask", question, options, resolve })),
    [],
  );
  const confirm = useCallback<Dialogs["confirm"]>(
    (question, options = {}) =>
      new Promise((resolve) => setPending({ kind: "confirm", question, options, resolve })),
    [],
  );
  const show = useCallback<Dialogs["show"]>(
    (message, options = {}) =>
      new Promise((resolve) => setPending({ kind: "show", message, options, resolve })),
    [],
  );
  const value = useMemo(() => ({ ask, confirm, show }), [ask, confirm, show]);

  const close = () => {
    if (!pending) return;
    if (pending.kind === "ask") pending.resolve(null);
    else if (pending.kind === "confirm") pending.resolve(false);
    else pending.resolve();
    setPending(null);
  };
  const accept = () => {
    if (!pending) return;
    if (pending.kind === "ask") {
      const required = pending.options.required !== false;
      if (required && !answer.trim()) return;
      pending.resolve(answer);
    } else if (pending.kind === "confirm") pending.resolve(true);
    else pending.resolve();
    setPending(null);
  };

  const title =
    pending?.options.title ??
    (pending?.kind === "ask" ? "A word first" : pending?.kind === "confirm" ? "Are you sure?" : "");
  const confirmLabel =
    pending && pending.kind !== "show" ? (pending.options.confirmLabel ?? "Continue") : "Done";
  const danger = pending && pending.kind !== "show" ? Boolean(pending.options.danger) : false;
  const blocked =
    pending?.kind === "ask" && pending.options.required !== false && !answer.trim();

  return (
    <DialogsContext.Provider value={value}>
      {children}
      <Modal
        open={pending !== null}
        title={title}
        onClose={close}
        footer={
          <>
            {pending?.kind !== "show" && (
              <button type="button" className="btn-secondary" onClick={close}>
                Cancel
              </button>
            )}
            <button
              type="submit"
              form="app-dialog-form"
              className={danger ? "btn-danger" : "btn-primary"}
              disabled={blocked}
            >
              {confirmLabel}
            </button>
          </>
        }
      >
        {pending && (
          <form
            id="app-dialog-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              accept();
            }}
          >
            <p className="whitespace-pre-line text-sm text-slate-700">
              {pending.kind === "show" ? pending.message : pending.question}
            </p>
            {pending.kind === "ask" &&
              (pending.options.multiline ? (
                <textarea
                  ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                  className="input"
                  rows={3}
                  value={answer}
                  placeholder={pending.options.placeholder}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              ) : (
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  className="input"
                  value={answer}
                  inputMode={pending.options.inputMode ?? "text"}
                  placeholder={pending.options.placeholder}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              ))}
            {pending.kind === "show" && pending.options.link && (
              <div className="flex gap-2">
                <input
                  className="input"
                  readOnly
                  value={pending.options.link}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  className="btn-secondary shrink-0"
                  onClick={() => {
                    void navigator.clipboard?.writeText(pending.options.link ?? "").then(
                      () => setCopied(true),
                      () => setCopied(false),
                    );
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </form>
        )}
      </Modal>
    </DialogsContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const value = useContext(DialogsContext);
  if (!value) throw new Error("useDialogs needs a DialogsProvider above it.");
  return value;
}
