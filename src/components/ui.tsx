/** Shared presentational building blocks used across every screen. */

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type SelectHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import {
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  REVIEW_POINT_STATUS_LABELS,
  REVIEW_POINT_STATUS_STYLES,
  SEVERITY_LABELS,
  SEVERITY_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  type Priority,
  type ReviewPointStatus,
  type ReviewSeverity,
  type TaskStatus,
} from "@shared/workflow";
import { describeDue } from "../lib/format";

// ---------------------------------------------------------------------- pills

export function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`pill ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityPill({ priority }: { priority: Priority }) {
  if (priority === "normal" || priority === "low") return null;
  return (
    <span className={`pill ${PRIORITY_STYLES[priority]}`}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: ReviewSeverity }) {
  return (
    <span className={`pill ${SEVERITY_STYLES[severity]}`}>
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

export function ReviewStatusPill({ status }: { status: ReviewPointStatus }) {
  return (
    <span className={`pill ${REVIEW_POINT_STATUS_STYLES[status]}`}>
      {REVIEW_POINT_STATUS_LABELS[status]}
    </span>
  );
}

/** Due-date chip that colours itself by lateness. */
export function DuePill({ date }: { date: string | null | undefined }) {
  const { text, tone } = describeDue(date);
  if (tone === "none") return <span className="text-xs text-slate-400">-</span>;
  const styles: Record<string, string> = {
    late: "bg-rose-50 text-rose-700 ring-rose-200",
    soon: "bg-amber-50 text-amber-800 ring-amber-200",
    ok: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return <span className={`pill ${styles[tone]}`}>{text}</span>;
}

// --------------------------------------------------------------------- states

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
        aria-hidden="true"
      />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start justify-between gap-3 rounded-md bg-rose-50 px-4 py-3
                 text-sm text-rose-800 ring-1 ring-inset ring-rose-200"
    >
      <span>{error}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-rose-600 hover:text-rose-900"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function SuccessBanner({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-start justify-between gap-3 rounded-md bg-emerald-50 px-4 py-3
                 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200"
    >
      <span>{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-emerald-600 hover:text-emerald-900"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------- forms

interface FieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  children: (id: string) => ReactNode;
}

/** Wires a label to its control and renders optional help text. */
export function Field({ label, hint, required, children }: FieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input ${props.className ?? ""}`} />;
}

/** Builds `<option>` elements from a value list and a label lookup. */
export function options<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
) {
  return values.map((value) => (
    <option key={value} value={value}>
      {labels[value]}
    </option>
  ));
}

/**
 * A labelled group of checkboxes over a fixed value list - the multi-select equivalent
 * of `Select` + `options`.
 *
 * A fieldset with a legend rather than `Field`, because `Field` pairs one `<label>` with
 * one control by id, and a group of checkboxes has no single control to point at. A
 * label whose `htmlFor` names a div is invalid, and a screen reader reads it as nothing.
 *
 * Checkboxes rather than a multiple `<select>`: a multi-select list box hides how many
 * options there are, needs a modifier key most people do not know about, and silently
 * clears the lot on a stray click.
 */
export function CheckboxGroup<T extends string>({
  legend,
  values,
  labels,
  selected,
  onChange,
  required,
  hint,
}: {
  legend: string;
  values: readonly T[];
  labels: Record<T, string>;
  selected: T[];
  onChange: (next: T[]) => void;
  required?: boolean;
  hint?: string;
}) {
  const toggle = (value: T) => {
    // Order is preserved as the person clicked, because the first one chosen becomes the
    // primary service line on an engagement, and re-sorting would silently change it.
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  return (
    <fieldset className="min-w-0">
      <legend className="label">
        {legend}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </legend>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {values.map((value) => (
          <label
            key={value}
            className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
          >
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() => toggle(value)}
            />
            {labels[value]}
          </label>
        ))}
      </div>
      {hint && <p className="hint">{hint}</p>}
    </fieldset>
  );
}

// --------------------------------------------------------------------- modal

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; focus moves into the dialog so keyboard users land inside it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative w-full ${wide ? "max-w-3xl" : "max-w-xl"} rounded-lg bg-panel shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost btn-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- misc

export function StatTile({
  label,
  value,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "warn" | "danger" | "good";
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    neutral: "text-slate-900",
    warn: "text-amber-700",
    danger: "text-rose-700",
    good: "text-emerald-700",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={`card px-4 py-3 text-left ${onClick ? "transition-shadow hover:shadow-md" : ""}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
    </Tag>
  );
}

/** Small key/value row used on detail panels. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{children}</dd>
    </div>
  );
}

export function Avatar({ name }: { name: string | null | undefined }) {
  const text = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <span
      title={name ?? undefined}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                 bg-brand-100 text-xs font-semibold text-brand-800"
    >
      {text}
    </span>
  );
}

/** Progress bar for checklist completion. */
export function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return <span className="text-xs text-slate-400">-</span>;
  const ratio = done / total;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${ratio === 1 ? "bg-emerald-500" : "bg-brand-500"}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-slate-500">
        {done}/{total}
      </span>
    </div>
  );
}
