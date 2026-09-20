/**
 * The work email address a member of staff is given, and how they are told about it.
 *
 * The portal does not create mailboxes. That is a deliberate limit rather than a gap,
 * and it is worth being plain about why, because the obvious ask is to have the portal
 * do it.
 *
 * Creating a mailbox means holding a credential that can administer the firm's email.
 * At Microsoft that is an application registration with `User.ReadWrite.All` and a
 * client secret; a credential that can create a mailbox can read one. Weighed against
 * a minute of an administrator's time per joiner - a few minutes a year at this firm's
 * size - that is a poor trade. It also ties the portal to one host's API: the firm
 * moves to another and the integration is written again from nothing.
 *
 * So the mailbox is created where mailboxes are created, in the host's own admin
 * centre, and the portal does the parts it is actually good at: working out what the
 * address should be, checking nobody else has it, handing the details to the new joiner
 * over a channel they can actually read, and keeping a record that it happened.
 *
 * The consequence is the thing the firm asked for. Changing host is a setting, not a
 * release - there is no integration to rewrite, because there is no integration. A host
 * nobody has heard of yet works on the day it is chosen.
 */

/**
 * Hosts the firm may say it uses.
 *
 * Presentation only. Nothing behaves differently per host: the label appears on screen
 * and in the message to the new joiner, and the link points at the place an
 * administrator goes to create the mailbox. That is the whole of it, which is why a
 * host missing from this list costs nothing - "Other" carries a name the firm types.
 */
export const EMAIL_HOSTS = ["microsoft365", "google", "zoho", "other"] as const;
export type EmailHost = (typeof EMAIL_HOSTS)[number];

export interface EmailHostSpec {
  label: string;
  /** Where an administrator goes to create the mailbox. Empty for a host we cannot know. */
  adminUrl: string;
  /** What the new joiner signs in to, in words they will recognise. */
  signInAt: string;
}

export const EMAIL_HOST_SPECS: Record<EmailHost, EmailHostSpec> = {
  microsoft365: {
    label: "Microsoft 365",
    adminUrl: "https://admin.microsoft.com/Adminportal/Home#/users",
    signInAt: "https://www.office.com",
  },
  google: {
    label: "Google Workspace",
    adminUrl: "https://admin.google.com/ac/users",
    signInAt: "https://mail.google.com",
  },
  zoho: {
    label: "Zoho Mail",
    adminUrl: "https://mailadmin.zoho.com",
    signInAt: "https://mail.zoho.com",
  },
  other: { label: "", adminUrl: "", signInAt: "" },
};

/** The firm's setting. `host_name` is used only when `host` is "other". */
export interface StaffEmailPolicy {
  enabled: boolean;
  host: EmailHost;
  host_name: string;
  domain: string;
  pattern: AddressPattern;
}

export const DEFAULT_STAFF_EMAIL: StaffEmailPolicy = {
  enabled: false,
  host: "microsoft365",
  host_name: "",
  domain: "",
  pattern: "first.last",
};

/** What the firm calls its host, whichever kind it is. */
export function hostLabel(policy: StaffEmailPolicy): string {
  if (policy.host === "other") return policy.host_name.trim() || "the firm's email host";
  return EMAIL_HOST_SPECS[policy.host].label;
}

export function hostAdminUrl(policy: StaffEmailPolicy): string {
  return policy.host === "other" ? "" : EMAIL_HOST_SPECS[policy.host].adminUrl;
}

// ---------------------------------------------------------------------------
// Working out the address
// ---------------------------------------------------------------------------

export const ADDRESS_PATTERNS = ["first.last", "f.last", "first", "manual"] as const;
export type AddressPattern = (typeof ADDRESS_PATTERNS)[number];

export const PATTERN_LABELS: Record<AddressPattern, string> = {
  "first.last": "first.last@",
  "f.last": "f.last@",
  first: "first@",
  manual: "Set each one by hand",
};

/**
 * Strips a name down to what may appear on the left of an @.
 *
 * Accents are folded rather than dropped, so Ekua Mensah-Appiah becomes
 * ekua.mensah-appiah and not ekuamensahappiah. Anything else goes: an address is
 * typed by people who did not choose the name, and a character that needs quoting is
 * a character somebody will get wrong every time.
 */
export function slug(part: string): string {
  return part
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The address this person would be given, or "" when the firm sets them by hand.
 *
 * A suggestion only. Every address is editable before it is recorded, because a
 * pattern cannot know about the second Ama Mensah, or the partner who has been
 * michael@ since the firm opened.
 */
export function suggestAddress(
  fullName: string,
  policy: StaffEmailPolicy,
): string {
  const domain = policy.domain.trim().replace(/^@+/, "").toLowerCase();
  if (!domain || policy.pattern === "manual") return "";

  const parts = fullName.trim().split(/\s+/).map(slug).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";

  const local =
    policy.pattern === "first" || !last
      ? first
      : policy.pattern === "f.last"
        ? `${first[0]}.${last}`
        : `${first}.${last}`;

  return local ? `${local}@${domain}` : "";
}

/**
 * Why this address cannot be used, or null.
 *
 * Deliberately not a full RFC 5321 check. The addresses this validates are ones the
 * firm is about to create at its own host, so the useful question is not "could this
 * exist somewhere" but "will this work everywhere and can somebody read it aloud".
 */
export function whyNotAnAddress(address: string): string | null {
  const value = address.trim();
  if (!value) return "Give the address, or leave the work email unset.";
  if (value.length > 254) return "That address is too long.";
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) {
    return "An address needs exactly one @, with something on each side.";
  }
  const [local, domain] = [value.slice(0, at), value.slice(at + 1)];
  if (!/^[a-zA-Z0-9._%+-]+$/.test(local)) {
    return "The part before the @ can use letters, numbers and . _ % + - only.";
  }
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return "The part before the @ cannot start, end, or double up on a full stop.";
  }
  if (!/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(domain)) {
    return "The part after the @ does not look like a domain.";
  }
  return null;
}

/** Whether an address sits on the firm's own domain. A warning, never a refusal. */
export function isOnFirmDomain(address: string, policy: StaffEmailPolicy): boolean {
  const domain = policy.domain.trim().replace(/^@+/, "").toLowerCase();
  if (!domain) return true;
  return address.trim().toLowerCase().endsWith(`@${domain}`);
}

// ---------------------------------------------------------------------------
// Reading and writing the setting
// ---------------------------------------------------------------------------

export function readStaffEmail(raw: string | null | undefined): StaffEmailPolicy {
  const out: StaffEmailPolicy = { ...DEFAULT_STAFF_EMAIL };
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  const value = parsed as Record<string, unknown>;

  out.enabled = value.enabled === true;
  if (typeof value.host === "string" && EMAIL_HOSTS.includes(value.host as EmailHost)) {
    out.host = value.host as EmailHost;
  }
  if (typeof value.host_name === "string") out.host_name = value.host_name.slice(0, 80);
  if (typeof value.domain === "string") {
    out.domain = value.domain.trim().replace(/^@+/, "").toLowerCase().slice(0, 200);
  }
  if (
    typeof value.pattern === "string" &&
    ADDRESS_PATTERNS.includes(value.pattern as AddressPattern)
  ) {
    out.pattern = value.pattern as AddressPattern;
  }
  return out;
}

export function writeStaffEmail(policy: StaffEmailPolicy): string {
  return JSON.stringify({
    enabled: policy.enabled,
    host: policy.host,
    host_name: policy.host === "other" ? policy.host_name.trim() : "",
    domain: policy.domain.trim().replace(/^@+/, "").toLowerCase(),
    pattern: policy.pattern,
  });
}

/**
 * Whether the firm has said enough for the portal to offer a work email at all.
 *
 * Switched on with no domain is a half-finished setting, and offering an address of
 * `ama.mensah@` to somebody would be worse than offering nothing.
 */
export function isConfigured(policy: StaffEmailPolicy): boolean {
  if (!policy.enabled) return false;
  if (!policy.domain.trim()) return false;
  if (policy.host === "other" && !policy.host_name.trim()) return false;
  return true;
}
