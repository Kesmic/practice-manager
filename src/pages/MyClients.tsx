/**
 * The clients allocated to the person signed in: what they hold, and what they have
 * been offered but not answered.
 *
 * The screen exists for one sentence in the Associate Consultant Agreement:
 *
 * > The Associate may decline the allocation of a further client where acceptance
 * > would, in the Associate's reasonable professional judgement, prejudice the proper
 * > performance of the Services in respect of an existing Assigned Client. A refusal on
 * > that ground shall not constitute a breach of this Agreement.
 *
 * A contractual right that can only be exercised by email is a right in name. Three
 * things follow for the layout.
 *
 * **Decline is beside Accept, not hidden behind it.** A screen that offers Accept
 * prominently and leaves Decline to be found communicates which answer is expected,
 * which is the opposite of what the clause is for.
 *
 * **The ground is chosen from a list.** Somebody exercising clause 8.2 should not have
 * to know it is clause 8.2, and the firm should not have to read a paragraph of prose
 * and work out afterwards which right was being used.
 *
 * **The consequence is stated before they answer, not after.** "A refusal on this
 * ground is not a breach of your agreement" is the whole reason the right is usable,
 * and somebody deciding whether to use it needs to read it at that moment.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ClientAllocation } from "@shared/types";
import {
  ALLOCATION_STATUS_LABELS,
  DECLINE_GROUNDS,
  GROUND_SPECS,
  TIER_LABELS,
  type DeclineGround,
} from "@shared/allocations";
import { ApiRequestError, api } from "../lib/api";
import { formatDate } from "../lib/format";
import {
  EmptyState,
  ErrorBanner,
  Modal,
  Spinner,
  SuccessBanner,
  TextArea,
} from "../components/ui";

export function MyClients() {
  const [allocations, setAllocations] = useState<ClientAllocation[] | null>(null);
  const [associate, setAssociate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [declining, setDeclining] = useState<ClientAllocation | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.myAllocations();
      setAllocations(result.allocations);
      setAssociate(result.on_associate_agreement);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load your clients.",
      );
      setAllocations([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!allocations) return <Spinner label="Loading your clients" />;

  const offered = allocations.filter((a) => a.status === "offered");
  const held = allocations.filter((a) => a.status === "accepted");
  const past = allocations.filter(
    (a) => a.status !== "offered" && a.status !== "accepted",
  );

  const accept = async (allocation: ClientAllocation) => {
    setBusy(true);
    setError(null);
    try {
      await api.acceptAllocation(allocation.id);
      await load();
      setNotice(`${allocation.client_name} is now assigned to you.`);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not accept that client.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">My clients</h1>
        <p className="text-sm text-slate-600">
          The clients assigned to you, and any offered to you and waiting on your answer.
          {associate ? (
            <>
              {" "}
              You may decline a further client where taking it on would, in your
              reasonable professional judgement, stop you performing properly for a
              client already assigned to you.{" "}
              <strong>A refusal on that ground is not a breach of your agreement.</strong>
            </>
          ) : null}
        </p>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      {offered.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Waiting on your answer
          </h2>
          {offered.map((allocation) => (
            <Offer
              key={allocation.id}
              allocation={allocation}
              associate={associate}
              busy={busy}
              onAccept={() => void accept(allocation)}
              onDecline={() => setDeclining(allocation)}
            />
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Assigned to you {held.length ? `(${held.length})` : ""}
        </h2>
        {!held.length ? (
          <EmptyState
            title="No clients assigned"
            description="Clients allocated to you and accepted appear here."
          />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            {held.map((allocation) => (
              <li key={allocation.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
                <Link className="link font-medium" to={`/clients/${allocation.client_id}`}>
                  {allocation.client_name}
                </Link>
                <span className="text-xs text-slate-500">{allocation.client_code}</span>
                {allocation.tier ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    {TIER_LABELS[allocation.tier]} tier
                  </span>
                ) : null}
                <span className="w-full text-xs text-slate-500">
                  Accepted{" "}
                  {allocation.responded_at ? formatDate(allocation.responded_at) : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length ? <History allocations={past} associate={associate} /> : null}

      <DeclineDialog
        allocation={declining}
        associate={associate}
        onClose={() => setDeclining(null)}
        onDeclined={async (message) => {
          setDeclining(null);
          await load();
          setNotice(message);
        }}
        setError={setError}
      />
    </div>
  );
}

function Offer({
  allocation,
  associate,
  busy,
  onAccept,
  onDecline,
}: {
  allocation: ClientAllocation;
  associate: boolean;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <article className="card space-y-3 ring-1 ring-amber-200">
      <div className="space-y-1">
        <h3 className="font-semibold text-slate-900">{allocation.client_name}</h3>
        <p className="text-xs text-slate-500">
          {allocation.client_code}
          {allocation.tier ? ` · ${TIER_LABELS[allocation.tier]} tier` : ""} · offered by{" "}
          {allocation.offered_by_name ?? "the firm"} on{" "}
          {formatDate(allocation.offered_at)}
        </p>
        {allocation.note ? (
          <p className="text-sm text-slate-700">{allocation.note}</p>
        ) : null}
      </div>

      <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Accepting means taking on the work for this client.{" "}
        {associate
          ? "If it would stop you performing properly for a client already assigned to you, decline - clause 8.2 says a refusal on that ground is not a breach."
          : "If you do not have the capacity to take it on properly, say so."}
      </p>

      {/*
        Both answers are given the same weight. A screen that makes Accept the obvious
        button and leaves Decline to be found tells the reader which answer is expected,
        which is exactly what the clause exists to prevent.
      */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={onAccept}
        >
          Accept this client
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={onDecline}
        >
          Decline
        </button>
      </div>
    </article>
  );
}

function DeclineDialog({
  allocation,
  associate,
  onClose,
  onDeclined,
  setError,
}: {
  allocation: ClientAllocation | null;
  associate: boolean;
  onClose: () => void;
  onDeclined: (message: string) => Promise<void>;
  setError: (m: string | null) => void;
}) {
  const [ground, setGround] = useState<DeclineGround>("capacity");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGround("capacity");
    setReason("");
  }, [allocation]);

  if (!allocation) return null;

  const spec = GROUND_SPECS[ground];

  const submit = async () => {
    if (spec.breach && !reason.trim()) {
      setError("Say why you are declining.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.declineAllocation(
        allocation.id,
        ground,
        reason.trim() || null,
      );
      await onDeclined(
        `You have declined ${allocation.client_name}. ${result.outcome}`,
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not decline that client.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Decline ${allocation.client_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Sending…" : "Decline this client"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800">
            On what ground?
          </legend>
          {DECLINE_GROUNDS.map((key) => (
            <label
              key={key}
              className="flex cursor-pointer items-start gap-2.5 rounded-md border border-slate-200 p-3"
            >
              <input
                type="radio"
                name="ground"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={ground === key}
                onChange={() => setGround(key)}
              />
              <span className="text-sm">
                <span className="font-medium text-slate-800">
                  {GROUND_SPECS[key].label}
                </span>
                <span className="hint mt-0.5 block">{GROUND_SPECS[key].detail}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/*
          Said before they answer rather than after. Whether a refusal counts against
          them is the whole reason the right is usable, and somebody deciding whether to
          use it needs to read it at that moment, not on the confirmation screen.
        */}
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            spec.breach
              ? "bg-amber-50 text-amber-900"
              : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {spec.breach
            ? "This is not one of the protected grounds. The firm will see the reason you give."
            : spec.clause && associate
              ? `Recorded under clause ${spec.clause}. A refusal on this ground is not a breach of your agreement.`
              : "Recorded as a protected ground. This does not count against you."}
        </p>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-800">
            Anything you want to add {spec.breach ? "" : "(optional)"}
          </span>
          <TextArea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              ground === "capacity"
                ? "Which clients this would prejudice, if you want to say."
                : ""
            }
          />
        </label>
      </div>
    </Modal>
  );
}

function History({
  allocations,
  associate,
}: {
  allocations: ClientAllocation[];
  associate: boolean;
}) {
  return (
    <section className="card space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">Earlier allocations</h2>
      <ul className="divide-y divide-slate-100">
        {allocations.map((a) => (
          <li key={a.id} className="py-2 text-sm">
            <span className="font-medium text-slate-800">{a.client_name}</span>{" "}
            <span className="text-slate-600">
              - {ALLOCATION_STATUS_LABELS[a.status]}
              {a.responded_at ? ` on ${formatDate(a.responded_at)}` : ""}
            </span>
            {a.decline_ground ? (
              <span className="mt-0.5 block text-xs text-slate-500">
                {GROUND_SPECS[a.decline_ground].label}.{" "}
                {!GROUND_SPECS[a.decline_ground].breach
                  ? associate && GROUND_SPECS[a.decline_ground].clause
                    ? `Not a breach of the agreement (clause ${GROUND_SPECS[a.decline_ground].clause}).`
                    : "Not held against you."
                  : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
