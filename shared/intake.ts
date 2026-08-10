/**
 * Client intake: the two public links and what arrives through them.
 *
 * The firm publishes two addresses. One goes to organisations that are not clients
 * yet, on the website and in a proposal; the other goes to clients who already have
 * a file open and want something else done. They collect different things, which is
 * the whole reason for having two: asking an existing client to retype its tax
 * number and registered address is how a form gets abandoned.
 *
 * Imported by both the Worker and the React app, so the fields the form asks for
 * and the fields the server insists on cannot drift apart.
 */

export const REQUEST_KINDS = ["new", "existing"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  new: "New client",
  existing: "Existing client",
};

/** What each link is for, in the words used on the admin screen. */
export const REQUEST_KIND_PURPOSE: Record<RequestKind, string> = {
  new: "For organisations that are not clients yet. Put this on the website, in proposals and in email signatures.",
  existing:
    "For clients who already have a file with the firm and want another piece of work. Send this one to your client contacts.",
};

export const REQUEST_STATUSES = ["new", "in_review", "accepted", "declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  new: "New",
  in_review: "Being looked at",
  accepted: "Accepted",
  declined: "Declined",
};

export const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
  new: "bg-amber-50 text-amber-800 ring-amber-200",
  in_review: "bg-brand-50 text-link ring-brand-200",
  accepted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  declined: "bg-slate-100 text-slate-600 ring-slate-200",
};

/** A request nobody has decided on yet. Drives the queue count and the sorting. */
export function isOpenRequest(status: RequestStatus): boolean {
  return status === "new" || status === "in_review";
}

/**
 * Requests are matched to clients by a person, never by the system.
 *
 * An anonymous visitor typing an organisation name must not be able to learn from
 * the response whether that organisation is a client of the firm. That rules out
 * automatic matching, and it is why an existing-client request still has to be
 * pointed at a client record by hand before it can be accepted.
 */
export function acceptRequirement(kind: RequestKind): string {
  return kind === "existing"
    ? "Choose which client this is before accepting it. The sender typed a name; only you can confirm which file it belongs to."
    : "Accepting this creates a client record from what was submitted, as a prospect. Check the details first, because they were typed by someone outside the firm.";
}

/** The most a public submission may contain, field by field. */
export const REQUEST_LIMITS = {
  organisation: 200,
  client_ref: 40,
  contact_name: 120,
  contact_email: 254,
  contact_phone: 40,
  tax_id: 64,
  registration_no: 64,
  industry: 120,
  address: 500,
  details: 4000,
  /** Whole request body. Generous for the form, small enough to be uninteresting. */
  body_bytes: 24_000,
} as const;

/**
 * How many submissions one sender may make in an hour, and how many the link as a
 * whole will take. The first stops a stuck submit button from filling the table,
 * the second bounds the damage if a link is scraped and used by a script.
 */
export const REQUEST_RATE = { perSender: 5, perLink: 60, windowMinutes: 60 } as const;

/** What the public form needs to know to render itself. */
export interface IntakeForm {
  kind: RequestKind;
  firm_name: string;
  firm_website: string;
}

/** One link, as the admin screen shows it. */
export interface IntakeLink {
  kind: RequestKind;
  /** Absolute address, ready to be copied into an email. */
  url: string;
  created_at: string | null;
}
