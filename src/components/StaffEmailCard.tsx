/**
 * Where the firm's email lives, and what each person's address should look like.
 *
 * The portal does not create mailboxes - shared/staff-email.ts argues for why. So this
 * screen collects three things and no credentials: which host the firm uses, the
 * domain, and the pattern an address follows. Nothing here can reach the host, which
 * is the point: changing host is a setting rather than a release, and a host nobody
 * has heard of yet works on the day it is chosen.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ADDRESS_PATTERNS,
  DEFAULT_STAFF_EMAIL,
  EMAIL_HOSTS,
  EMAIL_HOST_SPECS,
  PATTERN_LABELS,
  suggestAddress,
  type AddressPattern,
  type EmailHost,
  type StaffEmailPolicy,
} from "@shared/staff-email";
import { ApiRequestError, api } from "../lib/api";
import { ErrorBanner, Field, Select, Spinner, SuccessBanner, TextInput } from "./ui";

/** A name to show the pattern against. Any name would do; this one is not real. */
const EXAMPLE = "Ama Mensah";

export function StaffEmailCard({ canEdit }: { canEdit: boolean }) {
  const [draft, setDraft] = useState<StaffEmailPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDraft((await api.staffEmail()).policy);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load the setting.",
      );
      setDraft({ ...DEFAULT_STAFF_EMAIL });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!draft) return <Spinner label="Loading staff email" />;

  const set = <K extends keyof StaffEmailPolicy>(key: K, value: StaffEmailPolicy[K]) =>
    setDraft({ ...draft, [key]: value });

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setDraft((await api.saveStaffEmail(draft)).policy);
      setNotice("Saved.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  const preview = suggestAddress(EXAMPLE, draft);
  const spec = EMAIL_HOST_SPECS[draft.host];

  return (
    <div className="space-y-5">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      <section className="card space-y-4 p-5">
        <div>
          <h2 className="card-title">Where the firm&rsquo;s email lives</h2>
          <p className="muted mt-0.5">
            Used to work out each person&rsquo;s address and to tell them where to sign
            in. The portal does not create mailboxes - you make those at the host, and
            record the details here.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={!canEdit}
            checked={draft.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          <span>
            <strong>Give staff a work email address.</strong> Switched off, the portal
            asks for nothing and says nothing about work email.
          </span>
        </label>

        {draft.enabled && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Host">
                {(id) => (
                  <Select
                    id={id}
                    disabled={!canEdit}
                    value={draft.host}
                    onChange={(e) => set("host", e.target.value as EmailHost)}
                  >
                    {EMAIL_HOSTS.map((host) => (
                      <option key={host} value={host}>
                        {host === "other"
                          ? "Somewhere else"
                          : EMAIL_HOST_SPECS[host].label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {draft.host === "other" ? (
                <Field label="What it is called" required>
                  {(id) => (
                    <TextInput
                      id={id}
                      disabled={!canEdit}
                      value={draft.host_name}
                      placeholder="Fastmail"
                      onChange={(e) => set("host_name", e.target.value)}
                    />
                  )}
                </Field>
              ) : (
                <div className="self-end">
                  <p className="hint">
                    Mailboxes are created at{" "}
                    <a
                      className="link"
                      href={spec.adminUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      the {spec.label} admin centre
                    </a>
                    .
                  </p>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email domain" required>
                {(id) => (
                  <TextInput
                    id={id}
                    disabled={!canEdit}
                    value={draft.domain}
                    placeholder="kesmic.org"
                    onChange={(e) => set("domain", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Address pattern">
                {(id) => (
                  <Select
                    id={id}
                    disabled={!canEdit}
                    value={draft.pattern}
                    onChange={(e) => set("pattern", e.target.value as AddressPattern)}
                  >
                    {ADDRESS_PATTERNS.map((p) => (
                      <option key={p} value={p}>
                        {PATTERN_LABELS[p]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:bg-slate-800/40">
              {preview ? (
                <>
                  {EXAMPLE} would be offered <strong>{preview}</strong>. Every address
                  can be changed before it is recorded.
                </>
              ) : draft.pattern === "manual" ? (
                <>Each address is typed in when the person is set up.</>
              ) : (
                <>Give the domain and the portal will show the address it would offer.</>
              )}
            </div>
          </>
        )}

        {canEdit && (
          <div className="flex justify-end">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="card-title">Changing host later</h2>
        <p className="muted mt-1">
          Changing any of this never touches a mailbox. It changes what the portal
          offers next time somebody joins; everybody already here keeps the address
          they have. Because nothing connects to the host, a move to a different one is
          this screen and nothing else.
        </p>
      </section>
    </div>
  );
}
