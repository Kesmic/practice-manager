/**
 * Building a proposal from the firm's own packages.
 *
 * The partner chooses a package and the price follows it, so what goes out is the firm's
 * pricing unless somebody deliberately changes it - and where they do, the figure they
 * typed is what the document says. Nothing here invents a price.
 *
 * The package cards are the same ones a client sees, turning over to show what is
 * included, because a partner deciding what to propose is doing exactly what a client
 * does when they read it.
 */

import { useCallback, useEffect, useState } from "react";
import { TIER_LABELS, type ClientTier } from "@shared/subscriptions";
import type { AdditionalService, ProspectRow, TierInclusion, TierRow } from "@shared/types";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  currencyOf,
  formatAmount,
  type Currency,
} from "@shared/money";
import { ApiRequestError, api } from "../../lib/api";
import { PackageCards } from "../../components/PackageCards";
import {
  ErrorBanner,
  Field,
  Modal,
  Select,
  Spinner,
  TextArea,
  TextInput,
  options,
} from "../../components/ui";

interface Line {
  description: string;
  frequency: string;
  amount: string;
}

export function ProposalBuilder({
  prospect,
  onClose,
  onSaved,
}: {
  prospect: ProspectRow;
  onClose: () => void;
  onSaved: (reference: string) => Promise<void>;
}) {
  const [packages, setPackages] = useState<{
    tiers: TierRow[];
    inclusions: TierInclusion[];
    services: AdditionalService[];
  } | null>(null);
  const [tier, setTier] = useState<ClientTier | null>(null);
  const [currency, setCurrency] = useState<Currency>("GHS");
  const [fee, setFee] = useState("");
  const [discount, setDiscount] = useState("");
  const [address, setAddress] = useState("");
  const [salutation, setSalutation] = useState(prospect.contact_name ?? "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPackages(await api.partnerPackages());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load the packages.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Choosing a package fills the price and the currency from the firm's own catalogue. */
  const choose = (chosen: ClientTier) => {
    setTier(chosen);
    const row = packages?.tiers.find((t) => t.tier === chosen);
    if (row) {
      setCurrency(currencyOf(row.currency));
      setFee(row.monthly_fee === null ? "" : String(row.monthly_fee));
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { reference } = await api.createProposal(prospect.id, {
        tier,
        currency,
        monthly_fee: fee.trim() === "" ? null : Number(fee),
        discount: discount.trim() === "" ? 0 : Number(discount),
        prepared_for: prospect.business_name,
        address: address.trim() || undefined,
        salutation: salutation.trim() || undefined,
        note: note.trim() || undefined,
        lines: lines
          .filter((line) => line.description.trim())
          .map((line) => ({
            description: line.description.trim(),
            frequency: line.frequency,
            amount: Number(line.amount) || 0,
          })),
      });
      await onSaved(reference);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  const quoted = Number(fee) || 0;
  const extras = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const off = Number(discount) || 0;

  return (
    <Modal
      open
      wide
      title={`Proposal for ${prospect.business_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving..." : "Save as a draft"}
          </button>
        </>
      }
    >
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {!packages ? (
        <Spinner label="Loading the packages" />
      ) : (
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Which package are you proposing?
            </h3>
            <p className="hint mb-3">
              Point at one to see what is in it. Choosing it fills in our price, which you
              can change if you have agreed something else with us.
            </p>
            <PackageCards
              tiers={packages.tiers}
              inclusions={packages.inclusions}
              current={tier}
              onAsk={(chosen) => choose(chosen)}
              askLabel="Propose this one"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Package">
              {(id) => (
                <Select
                  id={id}
                  value={tier ?? ""}
                  onChange={(e) =>
                    e.target.value ? choose(e.target.value as ClientTier) : setTier(null)
                  }
                >
                  <option value="">No package, just the work below</option>
                  {packages.tiers.map((row) => (
                    <option key={row.tier} value={row.tier}>
                      {TIER_LABELS[row.tier]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Monthly fee" hint="Ours unless you change it.">
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
              )}
            </Field>
            <Field label="Quoted in" hint="Nothing is converted between the two.">
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
          </div>

          <div>
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Work quoted beside it</h3>
              <button
                type="button"
                className="btn-ghost btn-sm ml-auto"
                onClick={() =>
                  setLines((all) => [
                    ...all,
                    { description: "", frequency: "one_off", amount: "" },
                  ])
                }
              >
                Add a line
              </button>
            </div>
            {packages.services.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {packages.services.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    className="pill bg-slate-100 text-slate-700 ring-slate-200 hover:bg-brand-50 hover:text-link"
                    onClick={() =>
                      setLines((all) => [
                        ...all,
                        {
                          description: service.name,
                          frequency: "one_off",
                          amount: service.fee === null ? "" : String(service.fee),
                        },
                      ])
                    }
                  >
                    + {service.name}
                  </button>
                ))}
              </div>
            )}
            {lines.map((line, index) => (
              <div key={index} className="mb-2 grid gap-2 sm:grid-cols-[2fr,1fr,1fr,auto]">
                <TextInput
                  aria-label="What it is"
                  placeholder="What it is"
                  value={line.description}
                  onChange={(e) =>
                    setLines((all) =>
                      all.map((l, i) => (i === index ? { ...l, description: e.target.value } : l)),
                    )
                  }
                />
                <Select
                  aria-label="How often"
                  value={line.frequency}
                  onChange={(e) =>
                    setLines((all) =>
                      all.map((l, i) => (i === index ? { ...l, frequency: e.target.value } : l)),
                    )
                  }
                >
                  <option value="one_off">One-off</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annually</option>
                </Select>
                <TextInput
                  aria-label="Amount"
                  inputMode="decimal"
                  placeholder="Amount"
                  value={line.amount}
                  onChange={(e) =>
                    setLines((all) =>
                      all.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)),
                    )
                  }
                />
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setLines((all) => all.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Discount" hint="Shown on the proposal as a line of its own.">
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              )}
            </Field>
            <Field label="Dear ..." hint="How the letter opens.">
              {(id) => (
                <TextInput
                  id={id}
                  value={salutation}
                  onChange={(e) => setSalutation(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label="Their address" hint="Printed under 'Prepared for'.">
            {(id) => (
              <TextArea
                id={id}
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            )}
          </Field>
          <Field label="Anything to add" hint="A line under the pricing table.">
            {(id) => (
              <TextArea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>

          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-200">
            <span className="font-medium">What they will see: </span>
            {formatAmount(Math.max(quoted + extras - off, 0), currency)}
            {quoted > 0 && <span className="text-slate-500"> · {formatAmount(quoted, currency)} a month</span>}
            {off > 0 && <span className="text-slate-500"> · less {formatAmount(off, currency)}</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}
