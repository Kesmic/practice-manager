/**
 * How invoices are taxed, numbered, and what letterhead they carry.
 *
 * The tax section is the reason this screen exists in the shape it does. There is no VAT
 * field: an administrator adds lines, and each says whether it is charged on the fee or
 * on the fee plus the lines above it. That produces the Ghanaian arrangement - three
 * levies on the fee, then VAT on the fee plus the levies - and also the single-VAT case
 * and the no-tax case, from one mechanism.
 *
 * Because the order matters and the arithmetic is not obvious, the panel works the
 * current arrangement through on a round thousand and shows the result. Somebody
 * changing a rate should see what it does rather than be asked to check it themselves.
 */

import { useCallback, useEffect, useState } from "react";
import { BILLING_CATCH_UP_DAYS } from "@shared/billing";
import {
  TAX_BASES,
  TAX_BASIS_LABELS,
  type TaxBasis,
  type Totals,
} from "@shared/invoices";
import type { TaxLineRow } from "@shared/types";
import { ApiRequestError, api } from "../lib/api";
import {
  ErrorBanner,
  Field,
  Select,
  Spinner,
  SuccessBanner,
  TextArea,
  TextInput,
  options,
} from "./ui";
import { formatMoneyExact } from "../lib/format";
import { EmailWordingAdmin } from "./EmailWordingAdmin";

interface SettingsBag {
  [key: string]: string;
}

export function InvoicingAdmin() {
  const [settings, setSettings] = useState<SettingsBag | null>(null);
  const [lines, setLines] = useState<TaxLineRow[] | null>(null);
  const [example, setExample] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [basis, setBasis] = useState<TaxBasis>("net");
  const [form, setForm] = useState<SettingsBag>({});

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([api.taxLines(), api.settings()]);
      setLines(r.tax_lines);
      setExample(r.example);
      setSettings(s.settings as unknown as SettingsBag);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load the settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !lines) return <ErrorBanner error={error} />;
  if (!lines || !settings) return <Spinner label="Loading" />;

  const value = (key: string) => form[key] ?? settings[key] ?? "";
  const set = (key: string, v: string) => setForm((f) => ({ ...f, [key]: v }));

  const guard = async (what: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await what();
      setDone(message);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {done && <SuccessBanner message={done} onDismiss={() => setDone(null)} />}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Tax on invoices</h2>
        </div>
        <div className="space-y-4 p-4">
          <p className="muted">
            Applied in the order below. A levy is charged on the fee; VAT is charged on
            the fee <em>plus the lines above it</em>, so the order is not cosmetic. Leave
            this empty if the firm does not charge tax on its invoices.
          </p>

          {lines.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {lines.map((line, index) => (
                <div key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="w-5 text-xs tabular-nums text-slate-400">{index + 1}</span>
                  <span className="text-sm font-medium text-slate-800">{line.name}</span>
                  <span className="text-sm tabular-nums text-slate-600">{line.rate}%</span>
                  <span className="text-xs text-slate-500">{TAX_BASIS_LABELS[line.basis]}</span>
                  <span className="ml-auto flex gap-1">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy || index === 0}
                      onClick={() =>
                        void guard(
                          () =>
                            api.editTaxLine(line.id, {
                              name: line.name,
                              rate: line.rate,
                              basis: line.basis,
                              position: lines[index - 1].position - 1,
                            }),
                          `${line.name} moved up.`,
                        )
                      }
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-rose-700"
                      disabled={busy}
                      onClick={() =>
                        void guard(() => api.removeTaxLine(line.id), `${line.name} removed.`)
                      }
                    >
                      Remove
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              No tax lines are set, so invoices show the fee and nothing else. That is
              right if the firm is not VAT-registered - otherwise add them below.
            </p>
          )}

          {/*
            Worked through rather than described. The order and the bases interact, and
            an administrator changing a rate should see the effect rather than be asked
            to check the arithmetic.
          */}
          {example && lines.length > 0 && (
            <div className="rounded-md bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                What that does to a fee of {formatMoneyExact(1000)}
              </p>
              <dl className="space-y-0.5">
                <div className="flex">
                  <dt className="text-slate-600">Before tax</dt>
                  <dd className="ml-auto tabular-nums">{formatMoneyExact(example.net)}</dd>
                </div>
                {example.taxes.map((tax) => (
                  <div key={tax.id} className="flex">
                    <dt className="text-slate-600">
                      {tax.name} {tax.rate}%
                    </dt>
                    <dd className="ml-auto tabular-nums">{formatMoneyExact(tax.amount)}</dd>
                  </div>
                ))}
                <div className="flex border-t border-slate-200 pt-1 font-semibold">
                  <dt>Total</dt>
                  <dd className="ml-auto tabular-nums">{formatMoneyExact(example.gross)}</dd>
                </div>
              </dl>
            </div>
          )}

          <form
            className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-[1fr,7rem,1fr,auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void guard(
                () => api.addTaxLine({ name, rate: Number(rate), basis }),
                `${name} added.`,
              ).then(() => {
                setName("");
                setRate("");
              });
            }}
          >
            <Field label="Name">
              {(id) => (
                <TextInput
                  id={id}
                  required
                  value={name}
                  placeholder="NHIL"
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field label="Rate %">
              {(id) => (
                <TextInput
                  id={id}
                  required
                  inputMode="decimal"
                  value={rate}
                  placeholder="2.5"
                  onChange={(e) => setRate(e.target.value)}
                />
              )}
            </Field>
            <Field label="Charged on">
              {(id) => (
                <Select
                  id={id}
                  value={basis}
                  onChange={(e) => setBasis(e.target.value as TaxBasis)}
                >
                  {options(TAX_BASES, TAX_BASIS_LABELS)}
                </Select>
              )}
            </Field>
            <div className="flex items-end">
              <button type="submit" className="btn-secondary" disabled={busy || !name.trim()}>
                Add
              </button>
            </div>
          </form>
        </div>
      </section>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          /*
           * Only the fields changed here. The endpoint updates just the keys it is sent,
           * and sending every setting back would overwrite anything changed elsewhere
           * since this screen loaded - the email wording below, for one.
           */
          if (!Object.keys(form).length) {
            setDone("Nothing has changed.");
            return;
          }
          setBusy(true);
          void api
            .updateSettings(form as never)
            .then(() => {
              setForm({});
              setDone("Saved.");
              return load();
            })
            .catch((err) =>
              setError(err instanceof ApiRequestError ? err.message : "Could not save."),
            )
            .finally(() => setBusy(false));
        }}
      >
        <div className="card-header">
          <h2 className="card-title">Letterhead, numbering and withholding</h2>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Address" hint="One line per line. Printed under the firm's name.">
              {(id) => (
                <TextArea
                  id={id}
                  rows={2}
                  value={value("firm_address")}
                  onChange={(e) => set("firm_address", e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label="City">
            {(id) => (
              <TextInput id={id} value={value("firm_city")} onChange={(e) => set("firm_city", e.target.value)} />
            )}
          </Field>
          <Field label="Telephone">
            {(id) => (
              <TextInput id={id} value={value("firm_phone")} onChange={(e) => set("firm_phone", e.target.value)} />
            )}
          </Field>
          <Field label="Finance email" hint="Where clients reply about a bill.">
            {(id) => (
              <TextInput
                id={id}
                type="email"
                value={value("firm_finance_email")}
                onChange={(e) => set("firm_finance_email", e.target.value)}
              />
            )}
          </Field>
          <Field label="The firm's TIN">
            {(id) => (
              <TextInput id={id} value={value("firm_tax_id")} onChange={(e) => set("firm_tax_id", e.target.value)} />
            )}
          </Field>

          <div className="sm:col-span-2 border-t border-slate-200 pt-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Automatic monthly invoicing</h3>
            <p className="hint mb-3">
              On the billing day, every active subscription that has no invoice yet for the
              month is invoiced and sent, exactly as if a Partner had done it - discount,
              currency and partner commission included. Anyone it cannot bill (no fee set,
              work quoted in another currency) is reported to the Partners rather than sent.
              A run missed on the day is made up within {BILLING_CATCH_UP_DAYS} days; after
              that the month is left to be raised by hand. The finance email above is copied
              on every invoice and reminder.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Automatic invoicing">
                {(id) => (
                  <Select id={id} value={value("auto_billing") || "on"} onChange={(e) => set("auto_billing", e.target.value)}>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </Select>
                )}
              </Field>
              <Field label="Billing day of the month" hint="1 to 28, so that every month has one.">
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    value={value("billing_day") || "1"}
                    onChange={(e) => set("billing_day", e.target.value)}
                  />
                )}
              </Field>
            </div>
          </div>

          <div className="sm:col-span-2 border-t border-slate-200 pt-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Bank details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Account name">
                {(id) => (
                  <TextInput id={id} value={value("bank_account_name")} onChange={(e) => set("bank_account_name", e.target.value)} />
                )}
              </Field>
              <Field label="Account number">
                {(id) => (
                  <TextInput id={id} value={value("bank_account_number")} onChange={(e) => set("bank_account_number", e.target.value)} />
                )}
              </Field>
              <Field label="Bank">
                {(id) => (
                  <TextInput id={id} value={value("bank_name")} onChange={(e) => set("bank_name", e.target.value)} />
                )}
              </Field>
              <Field label="Branch">
                {(id) => (
                  <TextInput id={id} value={value("bank_branch")} onChange={(e) => set("bank_branch", e.target.value)} />
                )}
              </Field>
              <Field label="Swift code">
                {(id) => (
                  <TextInput id={id} value={value("bank_swift")} onChange={(e) => set("bank_swift", e.target.value)} />
                )}
              </Field>
            </div>
          </div>

          <div className="sm:col-span-2 border-t border-slate-200 pt-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              Withholding and numbering
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Withholding rate %"
                hint="Shown as a deduction on the invoice, so the balance due is what the client pays. Blank if clients do not withhold."
              >
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="decimal"
                    placeholder="7.5"
                    value={value("withholding_rate")}
                    onChange={(e) => set("withholding_rate", e.target.value)}
                  />
                )}
              </Field>
              <Field label="What it is called on the invoice">
                {(id) => (
                  <TextInput
                    id={id}
                    value={value("withholding_label")}
                    onChange={(e) => set("withholding_label", e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Invoice number format"
                hint="{CLIENT} the client's code, {YYYY} {MM} the period, {SEQ} a running number."
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={value("invoice_number_format")}
                    onChange={(e) => set("invoice_number_format", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Days to pay" hint="Printed as the terms, e.g. Net 15.">
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    value={value("invoice_terms_days")}
                    onChange={(e) => set("invoice_terms_days", e.target.value)}
                  />
                )}
              </Field>
            </div>
          </div>

          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>

      <EmailWordingAdmin />
    </div>
  );
}
