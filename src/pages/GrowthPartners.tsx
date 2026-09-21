/**
 * The firm's side of growth partners: who sells for us, what they are working on, and
 * what we owe them.
 *
 * Three decisions live here and nowhere else, and each is deliberately a decision rather
 * than something that happens by itself:
 *
 * **Admitting somebody.** An application is a row on a list until a Partner reads it.
 * Approving sets the terms - the rate, the months, the hold - onto that partner, so a
 * deal struck today survives the firm's standard terms changing later.
 *
 * **Extending a hold.** Ninety days is what a registration buys. Extending it needs a
 * reason, because a hold nobody can judge is a claim for ever.
 *
 * **Approving and paying a commission.** Two decisions, not one: an accrual says what
 * the arrangement produced, approving says the firm agrees, and recording payment says
 * it has gone.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  COMMISSION_STATE_LABELS,
  PARTNER_STATE_LABELS,
  PROSPECT_STAGE_LABELS,
  describeHold,
} from "@shared/growth-partners";
import type { GrowthPartnerOverview } from "@shared/types";
import { formatAmount } from "@shared/money";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import {
  ErrorBanner,
  Field,
  Modal,
  Select,
  Spinner,
  SuccessBanner,
  TextInput,
} from "../components/ui";
import { formatDate } from "../lib/format";

export function GrowthPartners() {
  const { can } = useSession();
  const [data, setData] = useState<GrowthPartnerOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [winning, setWinning] = useState<string | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    try {
      setData(await api.growthPartners());
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load the partners.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (what: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await what();
      setNotice(message);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not do that.");
    } finally {
      setBusy(false);
    }
  };

  const waiting = useMemo(
    () => data?.partners.filter((p) => p.status === "applied") ?? [],
    [data],
  );
  const working = useMemo(
    () => data?.partners.filter((p) => p.status !== "applied") ?? [],
    [data],
  );

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading growth partners" />;

  const partner = can("partner");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">Growth partners</h1>
        <p className="muted mt-1">
          People outside the firm who sell for it. They run the cycle - the pitch, the
          proposal, the engagement - and we come in when a meeting needs somebody from
          here.
        </p>
      </div>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {notice && <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />}

      {waiting.length > 0 && (
        <section className="card p-5">
          <h2 className="card-title">Waiting on us</h2>
          <p className="muted mt-1">
            An application is a row on a list. Nobody can sign in until it is approved.
          </p>
          <div className="mt-3 divide-y divide-slate-100">
            {waiting.map((row) => (
              <div key={row.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium text-slate-800">{row.full_name}</span>
                  <span className="text-sm text-slate-500">{row.email}</span>
                  {row.business_name && (
                    <span className="pill bg-slate-100 text-slate-700 ring-slate-200">
                      {row.business_name}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-500">
                    applied {formatDate(row.applied_at)}
                  </span>
                </div>
                {row.note && <p className="hint mt-1 max-w-prose">{row.note}</p>}
                {partner && (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => setApproving(row.id)}
                    >
                      Admit them
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(
                          `Why is ${row.full_name}'s application not going ahead? They are not shown this.`,
                          "",
                        );
                        if (reason === null) return;
                        void act(
                          () => api.setPartnerStatus(row.id, "ended", reason),
                          "Closed.",
                        );
                      }}
                    >
                      Not this time
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {working.map((row) => {
        const theirs = data.prospects.filter((p) => p.partner_id === row.id);
        const earned = data.commissions.filter(
          (c) => c.partner_id === row.id && c.status !== "cancelled",
        );
        const owed = earned.filter((c) => c.status !== "paid");

        return (
          <section key={row.id} className="card p-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="card-title">{row.full_name}</h2>
              <span className="text-sm text-slate-500">{row.email}</span>
              <span
                className={`pill ${
                  row.status === "active"
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                    : "bg-slate-100 text-slate-600 ring-slate-200"
                }`}
              >
                {PARTNER_STATE_LABELS[row.status]}
              </span>
              <span className="text-xs text-slate-500">
                {row.commission_rate}% · {row.commission_months} months ·{" "}
                {row.hold_days}-day hold
              </span>
              {!row.has_password && row.status === "active" && (
                <span className="pill bg-amber-50 text-amber-800 ring-amber-200">
                  Has not set a password
                </span>
              )}

              {partner && (
                <span className="ml-auto flex gap-1">
                  {row.status === "active" && (
                    <>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const { invitation_url } = await api.invitePartner(row.id);
                            window.prompt(
                              "Emailed. You can also hand this over directly:",
                              invitation_url,
                            );
                          }, "A link has gone out.")
                        }
                      >
                        Send a link
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt(
                            `Why is ${row.full_name} being suspended?`,
                            "",
                          );
                          if (reason === null) return;
                          void act(
                            () => api.setPartnerStatus(row.id, "suspended", reason),
                            `${row.full_name} suspended and signed out. What they have already earned is untouched.`,
                          );
                        }}
                      >
                        Suspend
                      </button>
                    </>
                  )}
                  {row.status === "suspended" && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => api.setPartnerStatus(row.id, "active"),
                          `${row.full_name} restored.`,
                        )
                      }
                    >
                      Restore
                    </button>
                  )}
                </span>
              )}
            </div>

            {/* ------------------------------------------------ their pipeline */}
            {theirs.length > 0 ? (
              <div className="mt-4 divide-y divide-slate-100">
                {theirs.map((prospect) => (
                  <div
                    key={prospect.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5"
                  >
                    <span className="text-sm font-medium text-slate-800">
                      {prospect.business_name}
                    </span>
                    <span className="pill bg-slate-100 text-slate-700 ring-slate-200">
                      {PROSPECT_STAGE_LABELS[prospect.stage]}
                    </span>
                    <span className="text-xs text-slate-500">
                      {describeHold(prospect, data.today)}
                    </span>
                    {prospect.client_name && (
                      <span className="text-xs text-emerald-700">
                        {prospect.client_name}
                      </span>
                    )}

                    {partner && prospect.stage !== "won" && prospect.stage !== "lost" && (
                      <span className="ml-auto flex gap-1">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => {
                            const days = window.prompt(
                              `Extend the hold on ${prospect.business_name} by how many days?`,
                              "90",
                            );
                            if (!days) return;
                            const reason = window.prompt(
                              "Why? A hold extended with nothing said about why is one nobody can judge later.",
                              "",
                            );
                            if (!reason?.trim()) return;
                            void act(
                              () =>
                                api.extendHold(prospect.id, Number(days), reason.trim()),
                              "Hold extended.",
                            );
                          }}
                        >
                          Extend the hold
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          disabled={busy}
                          onClick={async () => {
                            if (!clients.length) {
                              const list = await api.clients();
                              setClients(
                                (list.clients ?? []).map((c) => ({ id: c.id, name: c.name })),
                              );
                            }
                            setWinning(prospect.id);
                          }}
                        >
                          Mark signed
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted mt-3">Nothing registered yet.</p>
            )}

            {/* --------------------------------------------- what we owe them */}
            {earned.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Commission{owed.length > 0 ? ` - ${owed.length} outstanding` : ""}
                </h3>
                <div className="scroll-x mt-2">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Client</th>
                        <th>What for</th>
                        <th className="text-right">Worked out on</th>
                        <th className="text-right">Theirs</th>
                        <th>Where it is</th>
                      </tr>
                    </thead>
                    <tbody>
                      {earned.map((line) => (
                        <tr key={line.id}>
                          <td className="whitespace-nowrap">{formatDate(line.created_at)}</td>
                          <td>{line.client_name ?? "-"}</td>
                          <td>
                            {line.kind === "subscription"
                              ? `Month ${line.month_index}`
                              : "One-off"}
                            {line.invoice_number && (
                              <span className="text-slate-400"> · {line.invoice_number}</span>
                            )}
                          </td>
                          <td className="text-right tabular-nums">
                            {formatAmount(line.basis, line.currency)}
                          </td>
                          <td className="text-right font-medium tabular-nums">
                            {formatAmount(line.amount, line.currency)}
                          </td>
                          <td>
                            <span className="pill bg-slate-100 text-slate-700 ring-slate-200">
                              {COMMISSION_STATE_LABELS[line.status]}
                            </span>
                            {partner && line.status === "accrued" && (
                              <button
                                type="button"
                                className="btn-ghost btn-sm ml-2"
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    () => api.approveCommission(line.id),
                                    "Approved for payment.",
                                  )
                                }
                              >
                                Approve
                              </button>
                            )}
                            {partner && line.status === "approved" && (
                              <button
                                type="button"
                                className="btn-ghost btn-sm ml-2"
                                disabled={busy}
                                onClick={() => {
                                  const reference = window.prompt(
                                    "Payment reference, if you have one:",
                                    "",
                                  );
                                  if (reference === null) return;
                                  void act(
                                    () =>
                                      api.payCommission(line.id, reference.trim() || undefined),
                                    "Recorded as paid.",
                                  );
                                }}
                              >
                                Mark paid
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        );
      })}

      {approving && (
        <ApproveModal
          onClose={() => setApproving(null)}
          onSave={async (terms) => {
            await act(async () => {
              const { invitation_url } = await api.approvePartner(approving, terms);
              window.prompt(
                "Emailed to them. You can also hand this link over directly:",
                invitation_url,
              );
            }, "Admitted, and a link to set a password has gone out.");
            setApproving(null);
          }}
        />
      )}

      {winning && (
        <WonModal
          clients={clients}
          onClose={() => setWinning(null)}
          onSave={async (clientId) => {
            await act(
              () => api.markProspectWon(winning, clientId),
              "Recorded as signed. Their commission starts on the next invoice we raise.",
            );
            setWinning(null);
          }}
        />
      )}
    </div>
  );
}

function ApproveModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (terms: {
    commission_rate: number;
    commission_months: number;
    hold_days: number;
  }) => Promise<void>;
}) {
  const [rate, setRate] = useState("25");
  const [months, setMonths] = useState("6");
  const [holdDays, setHoldDays] = useState("90");

  return (
    <Modal
      open
      title="Admit them as a growth partner"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              void onSave({
                commission_rate: Number(rate),
                commission_months: Number(months),
                hold_days: Number(holdDays),
              })
            }
          >
            Admit them
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="muted">
          These are written onto this partner. Changing the firm's standard terms later
          will not change theirs.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Commission" hint="Per cent of the fee.">
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Billed months" hint="A paused month is not one of them.">
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            )}
          </Field>
          <Field label="Hold" hint="Days of exclusivity on a registration.">
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                value={holdDays}
                onChange={(e) => setHoldDays(e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function WonModal({
  clients,
  onClose,
  onSave,
}: {
  clients: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (clientId: string) => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");

  return (
    <Modal
      open
      title="Which client did they become?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!clientId}
            onClick={() => void onSave(clientId)}
          >
            Record it
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="muted">
          Set the client up first if they are not here yet. Attaching them is what starts
          the commission: every invoice we raise for them from now on is worked out
          against this partner's terms.
        </p>
        <Field label="Client">
          {(id) => (
            <Select id={id} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Choose one</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}
