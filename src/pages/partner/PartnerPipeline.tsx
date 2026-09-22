/**
 * A growth partner's pipeline: everything they are working on, and what to do next.
 *
 * Laid out as the cycle rather than as a table, because the cycle is the job: register a
 * business, pitch it, send a proposal, get the engagement signed. Each card says where
 * one has got to, how much of its hold is left, and the one or two moves available from
 * there - so the screen answers "what do I do now" without anybody reading a manual.
 *
 * Two things it is careful to say rather than imply:
 *
 * **The hold is finite.** Ninety days, counted down on the card, because a registration
 * that felt permanent would be a claim nobody could ever clear.
 *
 * **Signed is ours to declare.** The move to "signed" is not offered, and the card says
 * why: it happens when the client's account is set up at the firm.
 */

import { useCallback, useEffect, useState } from "react";
import {
  NEXT_STAGES,
  PROSPECT_STAGE_LABELS,
  describeHold,
  holdDaysLeft,
  type ProspectStage,
} from "@shared/growth-partners";
import type { PartnerPipeline as Pipeline, ProspectRow } from "@shared/types";
import { formatAmount } from "@shared/money";
import { ApiRequestError, api } from "../../lib/api";
import { usePartnerSession } from "../../lib/partner-auth";
import {
  ErrorBanner,
  Field,
  Modal,
  Spinner,
  SuccessBanner,
  TextArea,
  TextInput,
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { ProposalBuilder } from "./ProposalBuilder";

/** The tone of a stage, so a glance down the page reads as progress. */
const STAGE_TONE: Record<ProspectStage, string> = {
  registered: "bg-slate-100 text-slate-700 ring-slate-200",
  pitching: "bg-brand-50 text-link ring-brand-200",
  proposal_sent: "bg-amber-50 text-amber-800 ring-amber-200",
  contract_sent: "bg-violet-50 text-violet-800 ring-violet-200",
  won: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  lost: "bg-slate-100 text-slate-500 ring-slate-200",
};

const MOVE_LABELS: Record<ProspectStage, string> = {
  registered: "Back to registered",
  pitching: "Pitching it",
  proposal_sent: "Proposal sent",
  contract_sent: "Contract out",
  won: "Signed",
  lost: "Not proceeding",
};

export function PartnerPipeline() {
  const { partner } = usePartnerSession();
  const [data, setData] = useState<Pipeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [proposing, setProposing] = useState<ProspectRow | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.partnerPipeline());
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load your pipeline.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data || !partner) return <Spinner label="Loading your pipeline" />;

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

  const live = data.prospects.filter((p) => p.stage !== "lost");
  const lost = data.prospects.filter((p) => p.stage === "lost");

  const earnedOn = (prospect: ProspectRow) =>
    data.commissions
      .filter((c) => c.client_id && c.client_id === prospect.client_id && c.status !== "cancelled")
      .reduce((sum, c) => sum + c.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="section-title">My pipeline</h1>
          <p className="muted mt-1">
            Register a business and it is yours for {data.terms.hold_days} days. You earn{" "}
            {data.terms.rate}% of what they pay us for their first {data.terms.months}{" "}
            billed months.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary ml-auto"
          onClick={() => setRegistering(true)}
        >
          Register a business
        </button>
      </div>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {notice && <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />}

      {!live.length && (
        <div className="card p-6 text-center">
          <h2 className="card-title">Nothing registered yet</h2>
          <p className="muted mx-auto mt-1 max-w-prose">
            Registering a business tells us you are working on it and stops anybody else
            being credited with it. You do not need our permission first - register it,
            then pitch it.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {live.map((prospect) => {
          const proposals = data.proposals.filter((p) => p.prospect_id === prospect.id);
          const latest = proposals[0];
          const left = holdDaysLeft(prospect.hold_until, data.today);
          const earned = earnedOn(prospect);
          const currency =
            data.commissions.find((c) => c.client_id === prospect.client_id)?.currency ??
            "GHS";

          return (
            <section
              key={prospect.id}
              className="lift card flex flex-col p-5 ring-1 ring-inset ring-slate-200 hover:ring-brand-300"
            >
              <div className="flex flex-wrap items-start gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {prospect.business_name}
                  </h2>
                  <p className="muted">
                    {prospect.contact_name || "No contact named"}
                    {prospect.contact_email ? ` · ${prospect.contact_email}` : ""}
                  </p>
                </div>
                <span className={`pill ml-auto ${STAGE_TONE[prospect.stage]}`}>
                  {PROSPECT_STAGE_LABELS[prospect.stage]}
                </span>
              </div>

              {/*
                The countdown, drawn rather than only written. A partner glancing at six
                of these needs to see which one is running out without reading any of
                them.
              */}
              {prospect.stage !== "won" && (
                <div className="mt-3">
                  <div className="flex items-baseline justify-between text-xs">
                    <span
                      className={
                        left < 0
                          ? "font-medium text-rose-700"
                          : left <= 14
                            ? "font-medium text-amber-700"
                            : "text-slate-500"
                      }
                    >
                      {describeHold(prospect, data.today)}
                    </span>
                    <span className="text-slate-400">
                      registered {formatDate(prospect.registered_on)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-200">
                    <div
                      className={`h-full rounded ${
                        left < 0 ? "bg-rose-500" : left <= 14 ? "bg-amber-500" : "bg-brand-600"
                      }`}
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(100, (left / Math.max(data.terms.hold_days, 1)) * 100),
                        )}%`,
                      }}
                    />
                  </div>
                  {prospect.hold_extension_note && (
                    <p className="hint mt-1">Extended: {prospect.hold_extension_note}</p>
                  )}
                </div>
              )}

              {prospect.stage === "won" && (
                <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">
                  Signed{prospect.won_on ? ` on ${formatDate(prospect.won_on)}` : ""}.{" "}
                  {earned > 0
                    ? `${formatAmount(earned, currency)} earned so far.`
                    : "Nothing has been billed to them yet."}
                </p>
              )}

              {latest && (
                <p className="mt-3 text-sm text-slate-600">
                  Proposal {latest.reference} ·{" "}
                  {latest.status === "sent" && latest.viewed_at
                    ? `read ${formatDate(latest.viewed_at)}`
                    : latest.status === "sent"
                      ? "sent, not opened yet"
                      : latest.status}
                  {latest.monthly_fee !== null
                    ? ` · ${formatAmount(latest.monthly_fee, latest.currency)} a month`
                    : ""}
                </p>
              )}

              {prospect.note && <p className="hint mt-2">{prospect.note}</p>}

              {/*
                Nothing is offered on a signed prospect: it is the firm's now. The whole
                row goes rather than leaving a rule across an empty strip.
              */}
              <div
                className={`mt-4 flex-wrap gap-2 border-t border-slate-100 pt-3 ${
                  prospect.stage === "won" ? "hidden" : "flex"
                }`}
              >
                {NEXT_STAGES[prospect.stage]
                  .filter((next) => next !== "lost")
                  .map((next) => (
                    <button
                      key={next}
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => api.moveProspect(prospect.id, { stage: next }),
                          `${prospect.business_name}: ${MOVE_LABELS[next].toLowerCase()}.`,
                        )
                      }
                    >
                      {MOVE_LABELS[next]}
                    </button>
                  ))}

                {prospect.stage !== "won" && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => setProposing(prospect)}
                  >
                    {latest ? "Another proposal" : "Build a proposal"}
                  </button>
                )}

                {latest?.status === "draft" && (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const { link } = await api.sendProposal(latest.id);
                        window.prompt(
                          "Emailed to them. You can also send this link yourself:",
                          link,
                        );
                      }, `${latest.reference} is with them.`)
                    }
                  >
                    Send {latest.reference}
                  </button>
                )}

                {NEXT_STAGES[prospect.stage].includes("lost") && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm ml-auto"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(
                        `Why is ${prospect.business_name} not proceeding? Only we see this.`,
                        "",
                      );
                      if (reason === null) return;
                      void act(
                        () =>
                          api.moveProspect(prospect.id, {
                            stage: "lost",
                            lost_reason: reason.trim() || undefined,
                          }),
                        `${prospect.business_name} closed. The name is free for anybody now.`,
                      );
                    }}
                  >
                    Not proceeding
                  </button>
                )}
              </div>

              {prospect.stage === "contract_sent" && (
                <p className="hint mt-3">
                  We mark this signed once the client's account is set up here - it is not
                  something to declare from this side.
                </p>
              )}
            </section>
          );
        })}
      </div>

      {lost.length > 0 && (
        <section className="card p-5">
          <h2 className="card-title">Closed</h2>
          <div className="mt-2 divide-y divide-slate-100">
            {lost.map((prospect) => (
              <div key={prospect.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-medium text-slate-700">{prospect.business_name}</span>
                {prospect.lost_reason && (
                  <span className="text-slate-500">{prospect.lost_reason}</span>
                )}
                <button
                  type="button"
                  className="btn-ghost btn-sm ml-auto"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => api.moveProspect(prospect.id, { stage: "pitching" }),
                      `${prospect.business_name} is back in play.`,
                    )
                  }
                >
                  Back in play
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <RegisterModal
        open={registering}
        onClose={() => setRegistering(false)}
        onSave={async (body) => {
          await act(
            () => api.registerProspect(body),
            `${body.business_name} is registered and held for ${data.terms.hold_days} days.`,
          );
          setRegistering(false);
        }}
      />

      {proposing && (
        <ProposalBuilder
          prospect={proposing}
          onClose={() => setProposing(null)}
          onSaved={async (reference) => {
            setProposing(null);
            setNotice(`${reference} drafted. Read it through, then send it.`);
            await load();
          }}
        />
      )}
    </div>
  );
}

function RegisterModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (body: {
    business_name: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    sector?: string;
    note?: string;
  }) => Promise<void>;
}) {
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [sector, setSector] = useState("");
  const [note, setNote] = useState("");

  return (
    <Modal
      open={open}
      title="Register a business"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={businessName.trim().length < 2}
            onClick={() =>
              void onSave({
                business_name: businessName.trim(),
                contact_name: contactName.trim() || undefined,
                contact_email: contactEmail.trim() || undefined,
                contact_phone: contactPhone.trim() || undefined,
                sector: sector.trim() || undefined,
                note: note.trim() || undefined,
              })
            }
          >
            Register it
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Business name"
          hint="As they trade. If somebody has already registered them, we will tell you rather than let you spend a month on it."
        >
          {(id) => (
            <TextInput
              id={id}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who you deal with">
            {(id) => (
              <TextInput
                id={id}
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Their email" hint="A proposal goes straight to this address.">
            {(id) => (
              <TextInput
                id={id}
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Their telephone">
            {(id) => (
              <TextInput
                id={id}
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            )}
          </Field>
          <Field label="Sector" hint="Optional. It helps us pitch the right package.">
            {(id) => (
              <TextInput id={id} value={sector} onChange={(e) => setSector(e.target.value)} />
            )}
          </Field>
        </div>
        <Field label="Anything we should know" hint="Only the firm sees this.">
          {(id) => (
            <TextArea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
    </Modal>
  );
}
