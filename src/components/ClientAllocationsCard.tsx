/**
 * Who this client is allocated to, from the firm's side.
 *
 * An allocation is an offer until it is answered, which is what makes clause 8.2 of the
 * Associate agreement exercisable at all - there is nothing to decline about a column
 * that was simply set. So this card shows three states rather than one: who holds the
 * client, who has been asked and not answered, and who declined and on what ground.
 *
 * The declines are shown rather than tidied away on purpose. The ground is the whole
 * point: a refusal because taking the client on would prejudice one already assigned is
 * expressly not a breach, and a screen that lists it beside the others as a bare
 * "declined" turns a right into a mark on a record.
 */

import { useCallback, useEffect, useState } from "react";
import type { ClientAllocation } from "@shared/types";
import type { User } from "@shared/types";
import {
  ALLOCATION_STATUS_LABELS,
  GROUND_SPECS,
  TIER_LABELS,
} from "@shared/allocations";
import { ApiRequestError, api } from "../lib/api";
import { formatDate } from "../lib/format";
import { Field, Select, TextArea } from "./ui";

export function ClientAllocationsCard({
  clientId,
  clientName,
  colleagues,
  canAllocate,
  setError,
  setNotice,
}: {
  clientId: string;
  clientName: string;
  colleagues: User[];
  canAllocate: boolean;
  setError: (m: string | null) => void;
  setNotice: (m: string | null) => void;
}) {
  const [allocations, setAllocations] = useState<ClientAllocation[] | null>(null);
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAllocations((await api.clientAllocations(clientId)).allocations);
    } catch {
      setAllocations([]);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!allocations) return null;

  const live = allocations.filter(
    (a) => a.status === "offered" || a.status === "accepted",
  );
  const past = allocations.filter(
    (a) => a.status !== "offered" && a.status !== "accepted",
  );

  const offer = async () => {
    if (!userId) {
      setError("Choose who this client is being allocated to.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.offerClient(clientId, {
        user_id: userId,
        note: note.trim() || null,
      });
      setUserId("");
      setNote("");
      await load();
      setNotice(
        `${clientName} has been offered. It is theirs to accept or decline - it is not assigned until they accept.`,
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not offer that client.",
      );
    } finally {
      setBusy(false);
    }
  };

  const act = async (
    allocation: ClientAllocation,
    action: "withdraw" | "end",
  ) => {
    setBusy(true);
    setError(null);
    try {
      if (action === "withdraw") await api.withdrawAllocation(allocation.id);
      else await api.endAllocation(allocation.id);
      await load();
      setNotice(
        action === "withdraw"
          ? `The offer to ${allocation.user_name} has been withdrawn.`
          : `${clientName} has been reallocated away from ${allocation.user_name}. They have been asked to hand over the papers.`,
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not update that allocation.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Allocated to</h2>
      </div>

      <div className="space-y-4 p-4">
        {!live.length ? (
          <p className="text-sm text-slate-500">
            Nobody holds this client. An allocation is an offer - it is not assigned
            until the person accepts it.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {live.map((allocation) => (
              <li
                key={allocation.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2"
              >
                <span className="text-sm">
                  <span className="font-medium text-slate-800">
                    {allocation.user_name}
                  </span>
                  {allocation.tier ? (
                    <span
                      className="ml-2 text-xs text-slate-500"
                      title="From this client's subscription, which is where the package is set."
                    >
                      {TIER_LABELS[allocation.tier]} package
                    </span>
                  ) : null}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                      allocation.status === "accepted"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {ALLOCATION_STATUS_LABELS[allocation.status]}
                  </span>
                </span>
                {canAllocate ? (
                  <span className="flex gap-2">
                    {allocation.available_actions.includes("withdraw") ? (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={busy}
                        onClick={() => void act(allocation, "withdraw")}
                      >
                        Withdraw the offer
                      </button>
                    ) : null}
                    {allocation.available_actions.includes("end") ? (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={busy}
                        onClick={() => void act(allocation, "end")}
                      >
                        Reallocate away
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {past.length ? (
          <ul className="space-y-1 border-t border-slate-100 pt-3 text-sm">
            {past.map((allocation) => (
              <li key={allocation.id} className="text-slate-600">
                <span className="text-slate-800">{allocation.user_name}</span> -{" "}
                {ALLOCATION_STATUS_LABELS[allocation.status]}
                {allocation.responded_at
                  ? ` on ${formatDate(allocation.responded_at)}`
                  : ""}
                {allocation.decline_ground ? (
                  <span className="mt-0.5 block text-xs">
                    {GROUND_SPECS[allocation.decline_ground].label}.{" "}
                    {!GROUND_SPECS[allocation.decline_ground].breach ? (
                      <span className="text-emerald-700">
                        Not a breach
                        {GROUND_SPECS[allocation.decline_ground].clause
                          ? ` (clause ${GROUND_SPECS[allocation.decline_ground].clause})`
                          : ""}
                        .
                      </span>
                    ) : null}
                    {allocation.decline_reason ? ` ${allocation.decline_reason}` : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {canAllocate ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <Field label="Offer this client to">
              {(id) => (
                <Select
                  id={id}
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                >
                  <option value="">Choose somebody</option>
                  {colleagues.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {/*
              No tier control. Schedule 2 prices this fee by the client's package, and
              the package is set once, on the subscription above - two controls for one
              fact is how the two came to disagree on the same screen.
            */}
            <p className="hint">
              The fee under the agreement follows this client's package, which is set on
              their subscription. Leave an employee unpriced by not putting the client on
              a package.
            </p>
            <Field
              label="Anything they should know"
              hint="Shown to them when they decide."
            >
              {(id) => (
                <TextArea
                  id={id}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void offer()}
            >
              {busy ? "Offering…" : "Offer this client"}
            </button>
            <p className="hint">
              This is an offer, not an assignment. They may decline it where taking it on
              would stop them performing properly for a client already assigned to them,
              and a refusal on that ground is not a breach of their agreement.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
