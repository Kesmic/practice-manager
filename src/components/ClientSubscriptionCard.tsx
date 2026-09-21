/**
 * A client's subscription, on their record: the tier, the figures it is judged on, the
 * additional work, the invoices, and who at the client may sign in.
 *
 * Everything a Partner does routinely is here, because the alternative is four screens
 * and a client file that does not tell you what the client pays.
 *
 * The portal never moves anybody. The assessment says which tier the figures point at
 * and this says so plainly, but the move is a button a Partner presses, and the trail
 * records what they were on and what they paid before.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  SERVICE_STATE_LABELS,
  TIER_LABELS,
  TIER_ORDER,
  describeFee,
  nextStates,
  type ClientTier,

} from "@shared/subscriptions";
import {
  DISCOUNT_KINDS,
  DISCOUNT_KIND_LABELS,
  DISCOUNT_RUNS,
  DISCOUNT_RUN_LABELS,
  DISCOUNT_SCOPES,
  DISCOUNT_SCOPE_LABELS,
  describeDiscount,
  invoicesLeft,
  whyNotADiscount,
  type DiscountKind,
  type DiscountRun,
  type DiscountScope,
} from "@shared/discounts";
import type { ClientDiscountRow, ClientSubscriptionDetail } from "@shared/types";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  currencyOf,
  type Currency,
} from "@shared/money";
import { ApiRequestError, api } from "../lib/api";
import { TierMeters } from "./TierMeters";
import {
  ErrorBanner,
  Field,
  Modal,
  Select,
  Spinner,
  SuccessBanner,
  TextInput,
  options,
} from "./ui";
import { useSession } from "../lib/auth";
import { formatDate, formatMoney, formatMoneyExact } from "../lib/format";

export function ClientSubscriptionCard({ clientId }: { clientId: string }) {
  const { can } = useSession();
  const [data, setData] = useState<ClientSubscriptionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [discounting, setDiscounting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.clientSubscription(clientId));
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load the subscription.",
      );
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading the subscription" />;

  const partner = can("partner");
  const { subscription, assessment, criteria, tiers } = data;
  const currency = subscription?.currency ?? "GHS";

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

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Subscription</h2>
        {partner && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => setMoving(true)}>
            {subscription ? "Move tier or fee" : "Put them on a tier"}
          </button>
        )}
      </div>

      <div className="space-y-5 p-4">
        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {notice && <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />}

        {!subscription ? (
          <p className="muted">
            Not on a tier. Put them on one and their figures decide whether it still fits.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-lg font-semibold text-slate-900">
                {TIER_LABELS[subscription.tier]}
              </span>
              <span className="text-sm tabular-nums text-slate-700">
                {subscription.fee === null
                  ? "no fee set"
                  : `${formatMoney(subscription.fee, currency)} a month`}
              </span>
              {subscription.negotiated && (
                <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
                  Negotiated rate
                </span>
              )}
              {subscription.status !== "active" && (
                <span className="pill bg-amber-50 text-amber-800 ring-amber-200">
                  {subscription.status}
                </span>
              )}
              <span className="ml-auto text-xs text-slate-500">
                since {formatDate(subscription.started_on)}
              </span>
            </div>

            {assessment?.should_move && assessment.suggested && (
              <div className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
                <strong>
                  Outgrowing {TIER_LABELS[subscription.tier]} - their figures point at{" "}
                  {TIER_LABELS[assessment.suggested]}.
                </strong>
                <ul className="mt-1 list-disc pl-5">
                  {assessment.breaches.map((b) => {
                    const criterion = criteria.find((c) => c.id === b.criterion_id);
                    return (
                      <li key={b.criterion_id}>
                        {criterion?.name}: {b.value.toLocaleString("en-GB")} against{" "}
                        {b.ceiling.toLocaleString("en-GB")}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {assessment && criteria.length > 0 && (
              <div>
                <div className="mb-3 flex flex-wrap items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    The figures the tier is judged on
                  </h3>
                  <button
                    type="button"
                    className="btn-ghost btn-sm ml-auto"
                    onClick={() => setRecording(true)}
                  >
                    Record this month's figures
                  </button>
                </div>
                <TierMeters criteria={criteria} assessment={assessment} />
                <p className="hint mt-3">
                  Entered by your staff from the client's own records. The portal does not
                  guess at these, and a criterion nobody updates shows as not recorded
                  rather than as zero.
                </p>
              </div>
            )}
          </>
        )}

        {/* --- additional work ------------------------------------------- */}
        <div className="border-t border-slate-200 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Additional work</h3>
          {!data.client_services.length ? (
            <p className="muted">Nothing outside the subscription yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.client_services.map((service) => (
                <div key={service.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="text-sm font-medium text-slate-800">{service.name}</span>
                  <span className="pill bg-slate-100 text-slate-700 ring-slate-200">
                    {SERVICE_STATE_LABELS[service.status]}
                  </span>
                  {service.quoted_fee !== null && (
                    <span className="text-sm tabular-nums">
                      {formatMoneyExact(service.quoted_fee, service.currency)}
                    </span>
                  )}
                  {service.requested_by_name && (
                    <span className="text-xs text-slate-500">
                      asked for by {service.requested_by_name}
                    </span>
                  )}
                  {nextStates(service.status).length > 0 && (
                    <span className="ml-auto flex gap-1">
                      {nextStates(service.status).map((next) => (
                        <button
                          key={next}
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => {
                            /*
                             * Quoting asks for the fee, because a quote with no number
                             * is not a quote - the client would be asked to agree to
                             * nothing.
                             */
                            if (next === "quoted") {
                              const fee = window.prompt(
                                `What is the fee for ${service.name}?`,
                                service.quoted_fee?.toString() ?? "",
                              );
                              if (!fee?.trim()) return;
                              void act(
                                () =>
                                  api.moveClientService(service.id, {
                                    status: "quoted",
                                    quoted_fee: Number(fee),
                                  }),
                                "Quoted.",
                              );
                              return;
                            }
                            void act(
                              () => api.moveClientService(service.id, { status: next }),
                              SERVICE_STATE_LABELS[next] + ".",
                            );
                          }}
                        >
                          {next === "quoted"
                            ? "Quote it"
                            : next === "agreed"
                              ? "Agreed"
                              : next === "delivered"
                                ? "Delivered"
                                : "Not proceeding"}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.services.filter((s) => s.active).length > 0 && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <AddService
                services={data.services.filter((s) => s.active)}
                busy={busy}
                onAdd={(serviceId, name) =>
                  act(
                    () => api.addClientService(clientId, { service_id: serviceId }),
                    `${name} added.`,
                  )
                }
              />
            </div>
          )}
        </div>

        {/* --- discounts --------------------------------------------------- */}
        {partner && (
          <Discounts
            discounts={data.discounts}
            currency={currency}
            busy={busy}
            onIssue={() => setDiscounting(true)}
            onEnd={(discount) => {
              /*
               * A reason is asked for rather than optional. A discount that simply
               * stopped, with nothing saying why, is the thing a client asks about six
               * months later and nobody can answer.
               */
              const reason = window.prompt(
                "Why is this discount ending? The client is not shown this.",
                "",
              );
              if (!reason?.trim()) return;
              void act(
                () => api.endDiscount(discount.id, reason.trim()),
                "Discount ended. Invoices already issued are unchanged.",
              );
            }}
          />
        )}

        {/* --- billing ----------------------------------------------------- */}
        {partner && subscription && (
          <div className="border-t border-slate-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Billing</h3>
            <RaiseInvoice clientId={clientId} busy={busy} act={act} />
          </div>
        )}

        {/* --- logins ------------------------------------------------------ */}
        {partner && (
          <div className="border-t border-slate-200 pt-4">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Who can sign in</h3>
              <button
                type="button"
                className="btn-ghost btn-sm ml-auto"
                onClick={() => setInviting(true)}
              >
                Invite somebody
              </button>
            </div>
            {!data.logins.length ? (
              <p className="muted">
                Nobody at this client can sign in. Invite them and they set their own
                password - nobody here ever knows it.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.logins.map((login) => (
                  <div key={login.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <span className="text-sm font-medium text-slate-800">{login.full_name}</span>
                    <span className="text-xs text-slate-500">{login.email}</span>
                    <span
                      className={`pill ${
                        login.status === "active"
                          ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                          : login.status === "invited"
                            ? "bg-amber-50 text-amber-800 ring-amber-200"
                            : "bg-slate-100 text-slate-600 ring-slate-200"
                      }`}
                    >
                      {login.status === "invited"
                        ? "Invited, not yet signed in"
                        : login.status === "active"
                          ? "Active"
                          : "Suspended"}
                    </span>
                    <span className="ml-auto flex gap-1">
                      {/*
                        Offered once they are active as well as while they are waiting.
                        The same link is how somebody who has forgotten their password
                        sets another - without this, a client locked out on a Monday
                        morning could not be helped at all.
                      */}
                      {login.status !== "suspended" && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const { invitation_url } = await api.reinviteClientUser(login.id);
                              window.prompt(
                                login.status === "invited"
                                  ? "A fresh invitation has been emailed. You can also hand it over directly:"
                                  : "A link to set a new password has been emailed. You can also hand it over directly:",
                                invitation_url,
                              );
                            }, login.status === "invited"
                              ? "A fresh invitation has gone out."
                              : "A link to set a new password has gone out. Their old one still works until they use it.")
                          }
                        >
                          {login.status === "invited" ? "Send a fresh link" : "Send a reset link"}
                        </button>
                      )}
                      {login.status === "active" && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => api.setClientUserStatus(login.id, "suspended"),
                              `${login.full_name} suspended, and signed out everywhere.`,
                            )
                          }
                        >
                          Suspend
                        </button>
                      )}
                      {login.status === "suspended" && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => api.setClientUserStatus(login.id, "active"),
                              `${login.full_name} restored.`,
                            )
                          }
                        >
                          Restore
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- history ----------------------------------------------------- */}
        {data.history.length > 0 && (
          <div className="border-t border-slate-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">History</h3>
            <div className="divide-y divide-slate-100">
              {data.history.map((event) => (
                <div key={event.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="tabular-nums text-slate-500">
                    {formatDate(event.created_at)}
                  </span>
                  <span>
                    {event.kind === "moved" && event.from_tier && event.to_tier
                      ? `Moved from ${TIER_LABELS[event.from_tier]} to ${TIER_LABELS[event.to_tier]}`
                      : event.kind === "subscribed"
                        ? `Subscribed to ${event.to_tier ? TIER_LABELS[event.to_tier] : ""}`
                        : event.kind === "fee_changed"
                          ? "Fee changed"
                          : event.kind}
                    {event.from_fee !== null && event.to_fee !== null && (
                      <span className="text-slate-500">
                        {" "}
                        · {formatMoney(event.from_fee, currency)} →{" "}
                        {formatMoney(event.to_fee, currency)}
                      </span>
                    )}
                  </span>
                  <span className="ml-auto text-xs text-slate-500">{event.actor_name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <MoveTierModal
        open={moving}
        current={subscription}
        tiers={tiers}
        onClose={() => setMoving(false)}
        onSave={async (body) => {
          await act(
            () => api.saveClientSubscription(clientId, body),
            subscription ? "Moved." : "Subscribed.",
          );
          setMoving(false);
        }}
      />

      <RecordFiguresModal
        open={recording}
        criteria={criteria}
        onClose={() => setRecording(false)}
        onSave={async (asOf, values) => {
          await act(
            () => api.recordFigures(clientId, { as_of: asOf, values }),
            "Figures recorded.",
          );
          setRecording(false);
        }}
      />

      <DiscountModal
        open={discounting}
        currency={currency}
        onClose={() => setDiscounting(false)}
        onSave={async (body) => {
          await act(() => api.grantDiscount(clientId, body), "Discount issued.");
          setDiscounting(false);
        }}
      />

      <InviteModal
        open={inviting}
        onClose={() => setInviting(false)}
        onSave={async (email, fullName) => {
          await act(async () => {
            const { invitation_url } = await api.inviteClientUser(clientId, {
              email,
              full_name: fullName,
            });
            window.prompt(
              "Invitation emailed. You can also hand this link over directly - it works once:",
              invitation_url,
            );
          }, `${fullName} invited.`);
          setInviting(false);
        }}
      />
    </section>
  );
}

/**
 * What a client is getting off, and what they have had off before.
 *
 * One live discount at a time, which the database holds rather than this screen: the
 * button to issue another is simply not offered while one is running, and the Worker
 * refuses it anyway. Past discounts stay listed because "we gave them three months at
 * half price last year" is a thing somebody will need to look up.
 */
function Discounts({
  discounts,
  currency,
  busy,
  onIssue,
  onEnd,
}: {
  discounts: ClientDiscountRow[];
  currency: string;
  busy: boolean;
  onIssue: () => void;
  onEnd: (discount: ClientDiscountRow) => void;
}) {
  const live = discounts.find((d) => d.status === "active") ?? null;
  const past = discounts.filter((d) => d.status !== "active");
  const money = (amount: number) => formatMoney(amount, currency);

  return (
    <div className="border-t border-slate-200 pt-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Discounts</h3>
        {!live && (
          <button type="button" className="btn-ghost btn-sm ml-auto" onClick={onIssue}>
            Issue a discount
          </button>
        )}
      </div>

      {!live ? (
        <p className="muted">
          Nothing off at the moment. A discount comes off before tax and applies to
          invoices raised from now on - it never changes one already issued.
        </p>
      ) : (
        <div className="rounded-md bg-emerald-50 px-3 py-2.5 ring-1 ring-inset ring-emerald-200">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-emerald-900">
              {describeDiscount(live, money)}
            </span>
            <span className="text-xs text-emerald-800">{runningFor(live)}</span>
            <button
              type="button"
              className="btn-ghost btn-sm ml-auto"
              disabled={busy}
              onClick={() => onEnd(live)}
            >
              End it
            </button>
          </div>
          {live.reason && <p className="mt-1 text-sm text-emerald-900">{live.reason}</p>}
          <p className="mt-1 text-xs text-emerald-800">
            Granted {formatDate(live.created_at)}
            {live.granted_by_name ? ` by ${live.granted_by_name}` : ""}
          </p>
        </div>
      )}

      {past.length > 0 && (
        <div className="mt-3 divide-y divide-slate-100">
          {past.map((d) => (
            <div key={d.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2 text-sm">
              <span className="text-slate-700">{describeDiscount(d, money)}</span>
              <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
                {d.status === "spent" ? "Used up" : "Ended"}
              </span>
              <span className="text-xs text-slate-500">
                {d.used_count} invoice{d.used_count === 1 ? "" : "s"}
                {d.ended_reason ? ` · ${d.ended_reason}` : ""}
              </span>
              <span className="ml-auto text-xs text-slate-500">
                {formatDate(d.ended_at ?? d.created_at)}
                {d.ended_by_name ? ` · ${d.ended_by_name}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** How much of a discount is left, in the terms it was granted in. */
function runningFor(discount: ClientDiscountRow): string {
  if (discount.runs === "until") {
    return `until ${formatDate(discount.until_on ?? "")}, ${discount.used_count} invoice${
      discount.used_count === 1 ? "" : "s"
    } so far`;
  }
  const left = invoicesLeft(discount) ?? 0;
  return `${left} invoice${left === 1 ? "" : "s"} left`;
}

/**
 * Issuing one.
 *
 * The three decisions are laid out in the order they are made: how much, what it comes
 * off, and how long it lasts. The refusal comes from the same function the Worker uses,
 * so the screen and the server never disagree about what is allowed.
 */
function DiscountModal({
  open,
  currency,
  onClose,
  onSave,
}: {
  open: boolean;
  currency: string;
  onClose: () => void;
  onSave: (body: {
    kind: DiscountKind;
    value: number;
    applies_to: DiscountScope;
    runs: DiscountRun;
    invoice_count?: number | null;
    until_on?: string | null;
    reason?: string;
  }) => Promise<void>;
}) {
  const [kind, setKind] = useState<DiscountKind>("percentage");
  const [value, setValue] = useState("");
  const [appliesTo, setAppliesTo] = useState<DiscountScope>("subscription");
  const [runs, setRuns] = useState<DiscountRun>("once");
  const [count, setCount] = useState("3");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const refusal = whyNotADiscount({
    kind,
    value: Number(value),
    runs,
    invoice_count: Number(count),
    until_on: until || null,
    today,
  });

  return (
    <Modal
      open={open}
      title="Issue a discount"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!!refusal}
            onClick={() =>
              void onSave({
                kind,
                value: Number(value),
                applies_to: appliesTo,
                runs,
                invoice_count: runs === "count" ? Number(count) : null,
                until_on: runs === "until" ? until : null,
                reason: reason.trim() || undefined,
              })
            }
          >
            Issue it
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How much">
            {(id) => (
              <Select
                id={id}
                value={kind}
                onChange={(e) => setKind(e.target.value as DiscountKind)}
              >
                {options(DISCOUNT_KINDS, DISCOUNT_KIND_LABELS)}
              </Select>
            )}
          </Field>
          <Field label={kind === "percentage" ? "Per cent off" : `Amount off (${currency})`}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="What it comes off"
          hint="A discount on the subscription leaves additional work at its full fee, and the other way round."
        >
          {(id) => (
            <Select
              id={id}
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value as DiscountScope)}
            >
              {options(DISCOUNT_SCOPES, DISCOUNT_SCOPE_LABELS)}
            </Select>
          )}
        </Field>

        <Field
          label="How long it lasts"
          hint="Counted against invoices actually issued, so a draft you cancel does not use it up."
        >
          {(id) => (
            <Select
              id={id}
              value={runs}
              onChange={(e) => setRuns(e.target.value as DiscountRun)}
            >
              {options(DISCOUNT_RUNS, DISCOUNT_RUN_LABELS)}
            </Select>
          )}
        </Field>

        {runs === "count" && (
          <Field label="How many invoices">
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            )}
          </Field>
        )}

        {runs === "until" && (
          <Field label="Runs until" hint="Inclusive - an invoice raised on that day still gets it.">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                min={today}
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            )}
          </Field>
        )}

        <Field
          label="Why"
          hint="For the firm's own record. The client sees the discount on their invoice, not this."
        >
          {(id) => (
            <TextInput id={id} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>

        {refusal && value.trim() !== "" && <p className="hint text-rose-700">{refusal}</p>}
      </div>
    </Modal>
  );
}

function AddService({
  services,
  busy,
  onAdd,
}: {
  services: ClientSubscriptionDetail["services"];
  busy: boolean;
  onAdd: (id: string, name: string) => Promise<void>;
}) {
  const [chosen, setChosen] = useState("");
  const service = services.find((s) => s.id === chosen);
  return (
    <>
      <Field label="Add a service">
        {(id) => (
          <Select id={id} value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="">Choose one</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ·{" "}
                {describeFee(s.fee, s.fee_basis, (n) => formatMoney(n, s.currency))}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy || !service}
        onClick={() => service && void onAdd(service.id, service.name).then(() => setChosen(""))}
      >
        Add
      </button>
    </>
  );
}

function RaiseInvoice({
  clientId,
  busy,
  act,
}: {
  clientId: string;
  busy: boolean;
  act: (what: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [raised, setRaised] = useState<{ id: string; number: string } | null>(null);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Bill the month" hint="Delivered work not yet invoiced is picked up too.">
        {(id) => (
          <TextInput id={id} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        )}
      </Field>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={() =>
          void act(async () => {
            const r = await api.raiseInvoice(clientId, { period });
            setRaised(r);
          }, "Draft invoice raised.")
        }
      >
        Raise a draft
      </button>
      {raised && (
        <Link className="link text-sm" to={`/invoices/${raised.id}`}>
          {raised.number} →
        </Link>
      )}
    </div>
  );
}

function MoveTierModal({
  open,
  current,
  tiers,
  onClose,
  onSave,
}: {
  open: boolean;
  current: ClientSubscriptionDetail["subscription"];
  tiers: ClientSubscriptionDetail["tiers"];
  onClose: () => void;
  onSave: (body: {
    tier: ClientTier;
    monthly_fee: number | null;
    currency: Currency;
    started_on?: string;
    status?: "active" | "paused" | "ended";
  }) => Promise<void>;
}) {
  const [tier, setTier] = useState<ClientTier>(current?.tier ?? "starter");
  const [fee, setFee] = useState(current?.monthly_fee?.toString() ?? "");
  const [status, setStatus] = useState(current?.status ?? "active");
  const listed = tiers.find((t) => t.tier === tier);
  /*
   * Follows the package when the Partner has not chosen otherwise, because a client put
   * on a package priced in dollars is almost always being billed in dollars. Nothing
   * converts - see shared/money.ts - so this is the currency they actually pay in.
   */
  const [currency, setCurrency] = useState<Currency>(
    currencyOf(current?.currency ?? listed?.currency),
  );

  return (
    <Modal
      open={open}
      title={current ? "Move tier or fee" : "Put them on a tier"}
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
                tier,
                monthly_fee: fee.trim() === "" ? null : Number(fee),
                currency,
                status: status as "active" | "paused" | "ended",
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tier">
          {(id) => (
            <Select id={id} value={tier} onChange={(e) => setTier(e.target.value as ClientTier)}>
              {options(TIER_ORDER, TIER_LABELS)}
            </Select>
          )}
        </Field>
        <Field
          label="Fee a month"
          hint={
            listed?.monthly_fee === null || listed?.monthly_fee === undefined
              ? "This tier has no listed fee yet. Set one here, or in Portal settings."
              : `Blank uses the listed ${formatMoney(listed.monthly_fee, listed.currency)}. Fill it in only for a negotiated rate.`
          }
        >
          {(id) => (
            <TextInput
              id={id}
              inputMode="decimal"
              placeholder={listed?.monthly_fee?.toString() ?? ""}
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Billed in"
          hint={
            listed?.currency && currencyOf(listed.currency) !== currency
              ? `${TIER_LABELS[tier]} is listed in ${CURRENCY_LABELS[currencyOf(listed.currency)]}. Nothing is converted, so this client is billed in what you choose here.`
              : "Nothing is ever converted between the two."
          }
        >
          {(id) => (
            <Select
              id={id}
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {options(CURRENCIES, CURRENCY_LABELS)}
            </Select>
          )}
        </Field>
        <Field label="Standing" hint="Paused stops billing without ending the subscription.">
          {(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="ended">Ended</option>
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

function RecordFiguresModal({
  open,
  criteria,
  onClose,
  onSave,
}: {
  open: boolean;
  criteria: ClientSubscriptionDetail["criteria"];
  onClose: () => void;
  onSave: (asOf: string, values: Record<string, number>) => Promise<void>;
}) {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <Modal
      open={open}
      title="Record this month's figures"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              const out: Record<string, number> = {};
              for (const [id, raw] of Object.entries(values)) {
                if (raw.trim() !== "") out[id] = Number(raw);
              }
              void onSave(asOf, out);
            }}
          >
            Record
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="The date these describe"
          hint="Not the date you are typing them. A February figure entered in April is still February's."
        >
          {(id) => (
            <TextInput id={id} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          )}
        </Field>
        {criteria.map((criterion) => (
          <Field key={criterion.id} label={criterion.name} hint={criterion.how_measured ?? undefined}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={values[criterion.id] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [criterion.id]: e.target.value }))
                }
              />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function InviteModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (email: string, fullName: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");

  return (
    <Modal
      open={open}
      title="Invite somebody at this client"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!email.trim() || !fullName.trim()}
            onClick={() => void onSave(email.trim(), fullName.trim())}
          >
            Send the invitation
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="muted">
          They set their own password from a one-time link. Nobody here ever knows it,
          and they can only ever see this client.
        </p>
        <Field label="Their name" required>
          {(id) => (
            <TextInput id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          )}
        </Field>
        <Field label="Their email" required>
          {(id) => (
            <TextInput id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
      </div>
    </Modal>
  );
}
