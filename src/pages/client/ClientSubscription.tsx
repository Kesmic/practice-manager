/**
 * What a client subscribes to, and what the tier above would mean.
 *
 * The page the whole client portal exists for. Three things it is careful to say:
 *
 * Crossing a ceiling is a conversation, not an invoice. The portal never moves anybody,
 * and the page says so where somebody worried about a rising meter will read it.
 *
 * A fee that has not been set reads as "not set", never as zero or as blank. A client
 * seeing nothing where a fee should be will assume the worst of it.
 *
 * Asking for additional work is one click and then it is with the firm. The client is
 * never asked to agree a price they have not been quoted.
 */

import { useCallback, useEffect, useState } from "react";
import {
  SERVICE_STATE_CLIENT_LABELS,
  TIER_LABELS,
  describeFee,
  tierAbove,
  type ClientTier,
  servedTier,
} from "@shared/subscriptions";
import type { ClientPortalSubscription } from "@shared/types";
import { ApiRequestError, api } from "../../lib/api";
import { TierMeters } from "../../components/TierMeters";
import { PackageCards } from "../../components/PackageCards";
import { formatAmount } from "@shared/money";
import { describeDiscountTerm, discountAmount } from "@shared/discounts";
import { ErrorBanner, Spinner, SuccessBanner } from "../../components/ui";
import { formatDate, formatMoney } from "../../lib/format";

export function ClientSubscription() {
  const [data, setData] = useState<ClientPortalSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.clientMySubscription());
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load your account.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading your subscription" />;

  const { subscription, assessment, criteria, tiers, available, services } = data;
  const currency = subscription?.currency ?? "GHS";
  const discount = data?.discount ?? null;
  /*
   * What the discount takes off the monthly fee, when it bites on the subscription at
   * all. A discount on additional services only leaves the fee as it is, and is
   * described underneath instead.
   */
  const feeOff =
    discount &&
    subscription?.fee !== null &&
    subscription?.fee !== undefined &&
    discount.applies_to !== "services"
      ? discountAmount(discount, subscription.fee)
      : null;
  /*
   * The level they are served at, which is what the meters below measure against and
   * what "the package above" is above. Where a Partner has set it higher than the
   * package, the page says so, because a client given Growth's service on a Starter
   * fee should be able to see it rather than take it on trust.
   */
  const served = subscription ? servedTier(subscription) : null;
  const next = served ? tierAbove(served) : null;
  const nextTier = next ? tiers.find((t) => t.tier === next) : null;
  const mine = subscription ? tiers.find((t) => t.tier === subscription.tier) : null;

  const ask = async (serviceId: string, name: string) => {
    setBusy(serviceId);
    setError(null);
    try {
      await api.clientAskForService(serviceId);
      setNotice(`We have your request for ${name}. We will come back to you with a fee.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not send that.");
    } finally {
      setBusy(null);
    }
  };

  /*
   * Asking about a package is a message, not a move. The portal never re-tiers anybody
   * - see shared/subscriptions.ts - so this raises the question with the firm and says
   * so plainly rather than appearing to change what they pay.
   */
  const askAboutPackage = async (tier: ClientTier) => {
    setBusy(tier);
    setError(null);
    try {
      await api.clientAskAboutPackage(tier);
      setNotice(
        `We have your question about ${TIER_LABELS[tier]}. Nothing has changed on your account - somebody will come back to you.`,
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not send that.");
    } finally {
      setBusy(null);
    }
  };

  const decide = async (id: string, status: "agreed" | "declined") => {
    setBusy(id);
    setError(null);
    try {
      await api.clientMoveService(id, status);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not record that.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">Your subscription</h1>
        <p className="muted mt-1">
          What you are on with us, and where your business sits against it.
        </p>
      </div>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {notice && <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />}

      {!subscription ? (
        <div className="card p-5">
          <h2 className="card-title">Nothing is set up yet</h2>
          <p className="muted mt-1">
            We have not put your account on a package yet. Have a look at what we offer
            below, and ask us about any of them.
          </p>
        </div>
      ) : (
        <>
          <section className="card border-l-4 border-l-brand-600 p-5">
            <div className="flex flex-wrap items-start gap-4">
              <div>
                <span className="flex flex-wrap gap-2">
                  <span className="pill bg-brand-50 text-link ring-brand-200">
                    Your package since {formatDate(subscription.started_on)}
                  </span>
                  {subscription.service_tier && (
                    <span className="pill bg-teal-50 text-teal-800 ring-teal-200">
                      Served at {TIER_LABELS[subscription.service_tier]} level
                    </span>
                  )}
                </span>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  {TIER_LABELS[subscription.tier]}
                </h2>
                {mine?.summary && (
                  <p className="muted mt-1 max-w-prose">{mine.summary}</p>
                )}
              </div>
              <div className="ml-auto text-right">
                {/*
                  With a discount on the subscription, the listed fee is struck through
                  and what they actually pay stands in its place - a client who has been
                  given something should be able to see it without opening an invoice.
                */}
                {feeOff !== null && subscription.fee !== null ? (
                  <>
                    <div className="text-sm tabular-nums text-slate-500 line-through">
                      {formatMoney(subscription.fee, currency)}
                    </div>
                    <div className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                      {formatMoney(subscription.fee - feeOff, currency)}
                    </div>
                    <p className="muted">a month</p>
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                      {subscription.fee === null
                        ? "Not set"
                        : formatMoney(subscription.fee, currency)}
                    </div>
                    <p className="muted">
                      {subscription.fee === null ? "Ask us about your fee" : "a month"}
                    </p>
                  </>
                )}
              </div>
            </div>
            {discount && (
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">
                <span className="font-medium">
                  {feeOff !== null
                    ? `${formatMoney(feeOff, currency)} off`
                    : discount.kind === "percentage"
                      ? `${discount.value}% off`
                      : `${formatMoney(discount.value, currency)} off`}
                  {discount.kind === "percentage" && feeOff !== null
                    ? ` (${discount.value}%)`
                    : ""}
                </span>
                <span className="text-emerald-800">
                  {discount.applies_to === "subscription"
                    ? "your subscription"
                    : discount.applies_to === "services"
                      ? "additional services"
                      : "everything we bill you"}
                  {" · "}
                  {describeDiscountTerm(discount, formatDate)}
                </span>
              </p>
            )}
            {subscription.status !== "active" && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
                This subscription is {subscription.status}. Nothing is being billed while
                it is.
              </p>
            )}
          </section>

          {assessment && criteria.length > 0 && (
            <section className="card p-5">
              <h2 className="card-title">
                Where you sit against{" "}
                {subscription.service_tier
                  ? TIER_LABELS[subscription.service_tier]
                  : "this package"}
              </h2>
              {subscription.service_tier && (
                <p className="muted mt-1">
                  You are on {TIER_LABELS[subscription.tier]}, and we serve you at{" "}
                  {TIER_LABELS[subscription.service_tier]} level - so these are{" "}
                  {TIER_LABELS[subscription.service_tier]}&apos;s ceilings.
                </p>
              )}
              {data.figures.length > 0 && data.figures[0].as_of && (
                <p className="muted mb-4 mt-1">
                  Taken from your records to {formatDate(data.figures[0].as_of)}
                  {data.figures[0].recorded_by_name
                    ? ` by ${data.figures[0].recorded_by_name}`
                    : ""}
                  .
                </p>
              )}
              <TierMeters criteria={criteria} assessment={assessment} />

              {assessment.should_move && nextTier && (
                <div className="mt-5 rounded-md bg-amber-50 p-4 ring-1 ring-inset ring-amber-200">
                  <p className="text-sm font-semibold text-amber-900">
                    Your figures now point at {TIER_LABELS[nextTier.tier as ClientTier]}.
                  </p>
                  <p className="mt-1 text-sm text-amber-900">
                    {nextTier.monthly_fee === null
                      ? "We will talk to you about what that would mean."
                      : `That package is ${formatAmount(nextTier.monthly_fee, nextTier.currency)} a month.`}
                  </p>
                  <p className="mt-2 text-sm text-amber-900">
                    <strong>Nothing changes on its own.</strong> Crossing a ceiling starts
                    a conversation, not a new invoice. We will talk to you and agree a
                    date first.
                  </p>
                </div>
              )}

              {!assessment.should_move && next && nextTier && (
                <p className="hint mt-4">
                  The package above is {TIER_LABELS[next]}
                  {nextTier.monthly_fee !== null &&
                    `, at ${formatAmount(nextTier.monthly_fee, nextTier.currency)} a month`}
                  . You would move only after a conversation with us.
                </p>
              )}
            </section>
          )}
        </>
      )}

      {/*
        All four, not just theirs and the one above. A client who can see what the other
        packages are for is a client who can tell whether they are on the right one, and
        the question they come back with is a better question than "what am I paying
        for".
      */}
      {tiers.length > 0 && (
        <section className="card p-5">
          <h2 className="card-title mb-4">Our packages</h2>
          <PackageCards
            tiers={tiers}
            inclusions={data.inclusions}
            current={subscription?.tier ?? null}
            /*
              Only where the figures point upwards. Most criteria have no ceiling, so
              the cheapest package covers nearly everybody, and marking Starter as
              "fits your figures" would be telling every client they are overpaying.
              Whether they are is the firm's conversation to start, not a pill.
            */
            suggested={assessment?.should_move ? assessment.suggested : null}
            onAsk={(tier) => void askAboutPackage(tier)}
            askLabel="Ask us about this"
            busyTier={busy as ClientTier | null}
          />
        </section>
      )}

      {available.length > 0 && (
        <section className="card p-5">
          <h2 className="card-title">Additional services</h2>
          <p className="muted mb-3 mt-1">
            Not part of your subscription. Ask for any of these and we will confirm the
            fee before starting anything.
          </p>
          <div className="divide-y divide-slate-100">
            {available.map((service) => (
              <div key={service.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <span className="text-sm font-medium text-slate-800">{service.name}</span>
                {service.summary && (
                  <span className="order-last w-full text-xs text-slate-500">
                    {service.summary}
                  </span>
                )}
                <span className="ml-auto text-sm font-semibold tabular-nums text-slate-800">
                  {describeFee(service.fee, service.fee_basis, (n) =>
                    formatMoney(n, service.currency),
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy === service.id}
                  onClick={() => void ask(service.id, service.name)}
                >
                  {busy === service.id ? "Sending..." : "Ask about this"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {services.length > 0 && (
        <section className="card p-5">
          <h2 className="card-title">What you have asked for</h2>
          <div className="mt-2 divide-y divide-slate-100">
            {services.map((service) => (
              <div key={service.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <span className="text-sm font-medium text-slate-800">{service.name}</span>
                <span className="pill bg-slate-100 text-slate-700 ring-slate-200">
                  {SERVICE_STATE_CLIENT_LABELS[service.status]}
                </span>
                {service.quoted_fee !== null && (
                  <span className="text-sm tabular-nums text-slate-700">
                    {formatMoney(service.quoted_fee, service.currency)}
                  </span>
                )}
                {/*
                  The only decision a client makes here. Everything else on a request is
                  ours, and the fee is not read from anything they send.
                */}
                {service.status === "quoted" && (
                  <span className="ml-auto flex gap-2">
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={busy === service.id}
                      onClick={() => void decide(service.id, "agreed")}
                    >
                      Go ahead
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy === service.id}
                      onClick={() => void decide(service.id, "declined")}
                    >
                      Not now
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
