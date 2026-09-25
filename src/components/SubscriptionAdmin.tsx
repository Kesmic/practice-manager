/**
 * The subscription catalogue: what the firm prices on, what each package costs, what it
 * includes, and the work sold outside a package.
 *
 * There is no "add a package" here, and that is deliberate. Starter, Growth, Firm and
 * Enterprise are named in Schedule 2 of the Associate agreement and set what associates
 * are paid; a fifth added from a settings screen would be one no signed agreement has
 * heard of, and no rate to pay anybody servicing it. What is editable is everything
 * else: the criteria, each package's ceilings, its price and currency, who it is for,
 * and every line of what is in it.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  CRITERION_UNITS,
  CRITERION_UNIT_LABELS,
  FEE_BASES,
  FEE_BASIS_LABELS,
  TIER_LABELS,
  TIER_ORDER,
  describeFee,
  type ClientTier,
  type CriterionUnit,
  type FeeBasis,
} from "@shared/subscriptions";
import type { SubscriptionCatalogue } from "@shared/types";
import {
  PACKAGE_COLUMNS,
  serviceTree,
  whyNotAServiceName,
  type PackageService,
} from "@shared/package-services";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  DEFAULT_CURRENCY,
  currencyOf,
  formatAmount,
} from "@shared/money";
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

export function SubscriptionAdmin() {
  const [data, setData] = useState<SubscriptionCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.subscriptionCatalogue());
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load the catalogue.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading the catalogue" />;

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

      <CriteriaCard data={data} busy={busy} guard={guard} />
      <TiersCard data={data} busy={busy} guard={guard} />
      <PackageServicesCard data={data} busy={busy} guard={guard} />
      <ServicesCard data={data} busy={busy} guard={guard} />
    </div>
  );
}

type Guard = (what: () => Promise<unknown>, message: string) => Promise<void>;

function CriteriaCard({
  data,
  busy,
  guard,
}: {
  data: SubscriptionCatalogue;
  busy: boolean;
  guard: Guard;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<CriterionUnit>("count");
  const [how, setHow] = useState("");

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">What you price on</h2>
      </div>
      <div className="space-y-4 p-4">
        <p className="muted">
          A tier covers a size of business, expressed as a ceiling on each of these.
          Two of the three below are the tier descriptions already in the portal, turned
          into numbers. Add whatever else you actually price on.
        </p>

        {data.criteria.length > 0 && (
          <div className="divide-y divide-slate-100">
            {data.criteria.map((criterion) => (
              <div key={criterion.id} className="flex flex-wrap items-baseline gap-x-3 py-2.5">
                <span className="text-sm font-medium text-slate-800">{criterion.name}</span>
                <span className="text-xs text-slate-500">
                  {CRITERION_UNIT_LABELS[criterion.unit]}
                </span>
                {criterion.how_measured && (
                  <span className="order-last w-full text-xs text-slate-500">
                    {criterion.how_measured}
                  </span>
                )}
                <button
                  type="button"
                  className="btn-ghost btn-sm ml-auto text-rose-700"
                  disabled={busy}
                  onClick={() =>
                    void guard(async () => {
                      try {
                        await api.removeCriterion(criterion.id);
                      } catch (err) {
                        /*
                         * The server refuses while figures exist, and says how many.
                         * Repeated with confirm so somebody is told the cost before
                         * a year of measurements goes.
                         */
                        if (
                          err instanceof ApiRequestError &&
                          err.status === 409 &&
                          window.confirm(`${err.message}\n\nRemove it anyway?`)
                        ) {
                          await api.removeCriterion(criterion.id, true);
                        } else {
                          throw err;
                        }
                      }
                    }, `${criterion.name} removed.`)
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-[1fr,10rem,auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void guard(
              () => api.addCriterion({ name, unit, how_measured: how }),
              `${name} added.`,
            ).then(() => {
              setName("");
              setHow("");
            });
          }}
        >
          <Field label="Criterion">
            {(id) => (
              <TextInput
                id={id}
                required
                value={name}
                placeholder="Bank accounts"
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Unit">
            {(id) => (
              <Select
                id={id}
                value={unit}
                onChange={(e) => setUnit(e.target.value as CriterionUnit)}
              >
                {options(CRITERION_UNITS, CRITERION_UNIT_LABELS)}
              </Select>
            )}
          </Field>
          <div className="flex items-end">
            <button type="submit" className="btn-secondary" disabled={busy || !name.trim()}>
              Add
            </button>
          </div>
          <div className="sm:col-span-3">
            <Field
              label="How it is measured"
              hint="Shown wherever a figure is entered or read. A number means little without it."
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={how}
                  placeholder="Averaged over three months, from the bank and cash books."
                  onChange={(e) => setHow(e.target.value)}
                />
              )}
            </Field>
          </div>
        </form>
      </div>
    </section>
  );
}

function TiersCard({
  data,
  busy,
  guard,
}: {
  data: SubscriptionCatalogue;
  busy: boolean;
  guard: Guard;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const key = (tier: string, field: string) => `${tier}:${field}`;

  const valueOf = (tier: ClientTier, field: string, fallback: string) =>
    draft[key(tier, field)] ?? fallback;

  const save = (tier: ClientTier) => {
    const row = data.tiers.find((t) => t.tier === tier);
    const fee = valueOf(tier, "fee", row?.monthly_fee?.toString() ?? "").trim();
    const summary = valueOf(tier, "summary", row?.summary ?? "");
    const idealFor = valueOf(tier, "ideal_for", row?.ideal_for ?? "");
    const currency = valueOf(tier, "currency", row?.currency ?? DEFAULT_CURRENCY);
    const ceilings: Record<string, number | null> = {};
    for (const criterion of data.criteria) {
      const current = data.ceilings.find(
        (c) => c.tier === tier && c.criterion_id === criterion.id,
      );
      const raw = valueOf(tier, criterion.id, current?.ceiling?.toString() ?? "").trim();
      ceilings[criterion.id] = raw === "" ? null : Number(raw);
    }
    void guard(
      () =>
        api.saveTier(tier, {
          monthly_fee: fee === "" ? null : Number(fee),
          currency: currencyOf(currency),
          summary,
          ideal_for: idealFor,
          ceilings,
        }),
      `${TIER_LABELS[tier]} saved.`,
    );
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">The packages</h2>
      </div>
      <div className="space-y-5 p-4">
        <p className="muted">
          The four in the firm's pricing proposal. The names are fixed, because the
          Associate agreement prices what associates are paid by them, but everything
          here is yours: the price, the currency, who each one is for, and what is in it.
          A blank ceiling means no ceiling - which is why Firm, having none, is the
          package everybody who outgrows Growth lands on, and the move to Enterprise is
          your judgement rather than a threshold.
        </p>

        {TIER_ORDER.map((tier) => {
          const row = data.tiers.find((t) => t.tier === tier);
          return (
            <div
              key={tier}
              className="rounded-lg ring-1 ring-slate-200 transition-shadow hover:shadow-md"
            >
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2.5">
                <h3 className="text-sm font-semibold text-slate-900">{TIER_LABELS[tier]}</h3>
                <span className="text-xs text-slate-500">
                  {row?.monthly_fee === null || row?.monthly_fee === undefined
                    ? "No price set"
                    : `${formatAmount(row.monthly_fee, row.currency)} a month`}
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-sm ml-auto"
                  disabled={busy}
                  onClick={() => save(tier)}
                >
                  Save
                </button>
              </div>

              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <Field label="Price a month" hint="Leave blank if it has not been decided.">
                  {(id) => (
                    <TextInput
                      id={id}
                      inputMode="decimal"
                      value={valueOf(tier, "fee", row?.monthly_fee?.toString() ?? "")}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [key(tier, "fee")]: e.target.value }))
                      }
                    />
                  )}
                </Field>
                <Field
                  label="Quoted in"
                  hint="Nothing is ever converted: this is the currency the client is billed in."
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={valueOf(tier, "currency", row?.currency ?? DEFAULT_CURRENCY)}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [key(tier, "currency")]: e.target.value }))
                      }
                    >
                      {options(CURRENCIES, CURRENCY_LABELS)}
                    </Select>
                  )}
                </Field>

                <Field label="Who it is for" hint="The first thing a client reads about it.">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={valueOf(tier, "ideal_for", row?.ideal_for ?? "")}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [key(tier, "ideal_for")]: e.target.value }))
                      }
                    />
                  )}
                </Field>
                <Field label="What it covers" hint="A sentence, under the heading.">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={valueOf(tier, "summary", row?.summary ?? "")}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [key(tier, "summary")]: e.target.value }))
                      }
                    />
                  )}
                </Field>

                {data.criteria.map((criterion) => {
                  const current = data.ceilings.find(
                    (c) => c.tier === tier && c.criterion_id === criterion.id,
                  );
                  return (
                    <Field
                      key={criterion.id}
                      label={`${criterion.name} ceiling`}
                      hint="Blank means no ceiling."
                    >
                      {(id) => (
                        <TextInput
                          id={id}
                          inputMode="decimal"
                          placeholder="No ceiling"
                          value={valueOf(tier, criterion.id, current?.ceiling?.toString() ?? "")}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [key(tier, criterion.id)]: e.target.value }))
                          }
                        />
                      )}
                    </Field>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The firm's services and sub-services, and which package includes which.
 *
 * Two things on one card because they are one decision: what the firm does, and what
 * each package gets of it. The matrix is edited as a whole and saved as a whole, one
 * column per package, because "Growth gets everything Starter gets, plus these" is
 * easier to see as ticks in a grid than as four separate lists.
 */
function PackageServicesCard({
  data,
  busy,
  guard,
}: {
  data: SubscriptionCatalogue;
  busy: boolean;
  guard: Guard;
}) {
  const [newService, setNewService] = useState("");
  const [newSub, setNewSub] = useState<Record<string, string>>({});
  /*
   * The matrix as edited. Seeded from what is saved and reset whenever the catalogue
   * reloads, so a save elsewhere on the page never leaves stale ticks here.
   */
  /*
   * The matrix as edited: per package, the services ticked, each with its note. A tick
   * with an empty note is "included, plainly"; a note says how often or how deep -
   * "monthly", "weekly", "full IFRS" - and prints after the name on the package card.
   */
  const [ticks, setTicks] = useState<Record<string, Map<string, string>>>({});
  const [dirty, setDirty] = useState(false);
  const saved = useMemo(() => {
    const out: Record<string, Map<string, string>> = {};
    for (const tier of PACKAGE_COLUMNS) out[tier] = new Map();
    for (const i of data.service_inclusions) out[i.tier]?.set(i.service_id, i.note ?? "");
    return out;
  }, [data.service_inclusions]);
  useEffect(() => {
    setTicks(Object.fromEntries(Object.entries(saved).map(([t, m]) => [t, new Map(m)])));
    setDirty(false);
  }, [saved]);

  const tree = serviceTree(data.package_services);
  const retired = data.package_services.filter((s) => s.active !== 1);
  const ticked = (tier: ClientTier, id: string) => ticks[tier]?.has(id) ?? false;
  const noteOf = (tier: ClientTier, id: string) => ticks[tier]?.get(id) ?? "";
  const toggle = (tier: ClientTier, id: string) => {
    setTicks((prev) => {
      const next = { ...prev, [tier]: new Map(prev[tier] ?? []) };
      if (next[tier].has(id)) next[tier].delete(id);
      else next[tier].set(id, "");
      return next;
    });
    setDirty(true);
  };
  const annotate = (tier: ClientTier, id: string, note: string) => {
    setTicks((prev) => {
      const next = { ...prev, [tier]: new Map(prev[tier] ?? []) };
      next[tier].set(id, note);
      return next;
    });
    setDirty(true);
  };
  const saveMatrix = () =>
    void guard(
      () =>
        Promise.all(
          PACKAGE_COLUMNS.map((tier) =>
            api.savePackageServices(
              tier,
              [...(ticks[tier] ?? [])].map(([id, note]) => ({ id, note: note.trim() || null })),
            ),
          ),
        ),
      "What each package includes is saved.",
    );
  const rename = (id: string, current: string) => {
    const name = window.prompt("Rename it to:", current);
    if (name === null || name.trim() === current) return;
    const reason = whyNotAServiceName(name);
    if (reason) {
      window.alert(reason);
      return;
    }
    void guard(() => api.updatePackageService(id, { name: name.trim() }), "Renamed.");
  };
  const remove = (id: string, name: string) => {
    if (!window.confirm(`Remove ${name} from the catalogue and from every package?`)) return;
    void guard(() => api.deletePackageService(id), `${name} removed.`);
  };
  const retire = (id: string, name: string) =>
    void guard(() => api.updatePackageService(id, { active: false }), `${name} retired.`);
  const restore = (id: string, name: string) =>
    void guard(() => api.updatePackageService(id, { active: true }), `${name} is back.`);

  const row = (service: PackageService, sub: boolean) => (
    <tr key={service.id} className={sub ? "" : "bg-slate-50/60"}>
      <td className={`py-1.5 pr-3 ${sub ? "pl-7 text-slate-700" : "font-medium text-slate-900"}`}>
        <span>{service.name}</span>
        <span className="ml-2 whitespace-nowrap text-xs">
          <button type="button" className="link" disabled={busy} onClick={() => rename(service.id, service.name)}>
            rename
          </button>
          {" · "}
          <button type="button" className="link" disabled={busy} onClick={() => retire(service.id, service.name)}>
            retire
          </button>
          {" · "}
          <button type="button" className="link" disabled={busy} onClick={() => remove(service.id, service.name)}>
            remove
          </button>
        </span>
      </td>
      {PACKAGE_COLUMNS.map((tier) => (
        <td key={tier} className="py-1.5 text-center align-top">
          <input
            type="checkbox"
            aria-label={`${service.name} in ${TIER_LABELS[tier]}`}
            checked={ticked(tier, service.id)}
            onChange={() => toggle(tier, service.id)}
          />
          {ticked(tier, service.id) && sub && (
            <input
              type="text"
              aria-label={`Note on ${service.name} in ${TIER_LABELS[tier]}`}
              placeholder="note"
              value={noteOf(tier, service.id)}
              onChange={(e) => annotate(tier, service.id, e.target.value)}
              className="mt-1 block w-24 rounded border border-slate-200 px-1.5 py-0.5 text-center text-[11px] text-slate-700 placeholder:text-slate-300"
            />
          )}
        </td>
      ))}
    </tr>
  );

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Services, and what each package includes</h2>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={busy || !dirty}
          onClick={saveMatrix}
        >
          Save what each package includes
        </button>
      </div>
      <div className="space-y-5 p-4">
        <p className="muted">
          A service is a thing the firm does - Tax compliance; a sub-service is a part of
          it - VAT returns. Tick what each package includes; ticking a sub-service brings
          its service along as the heading. The small box under a tick is a note that
          prints after the name - &ldquo;monthly&rdquo; for one package and &ldquo;weekly&rdquo;
          for the next. Rename, retire or remove any line; a retired one stays on the
          record of a client who was given it.
        </p>

        {tree.length === 0 ? (
          <p className="muted">No services yet. Add the first one below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Service</th>
                  {PACKAGE_COLUMNS.map((tier) => (
                    <th key={tier} className="py-1.5 text-center font-medium">
                      {TIER_LABELS[tier]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tree.map((service) => (
                  <Fragment key={service.id}>
                    {row(service, false)}
                    {service.children.map((child) => row(child, true))}
                    <tr>
                      <td className="py-1.5 pl-7 pr-3" colSpan={1 + PACKAGE_COLUMNS.length}>
                        <form
                          className="flex max-w-md gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const name = (newSub[service.id] ?? "").trim();
                            const reason = whyNotAServiceName(name);
                            if (reason) return;
                            void guard(
                              () => api.addPackageService({ name, parent_id: service.id }),
                              `${name} added under ${service.name}.`,
                            );
                            setNewSub((d) => ({ ...d, [service.id]: "" }));
                          }}
                        >
                          <TextInput
                            aria-label={`New sub-service under ${service.name}`}
                            placeholder={`Add a sub-service under ${service.name}`}
                            value={newSub[service.id] ?? ""}
                            onChange={(e) =>
                              setNewSub((d) => ({ ...d, [service.id]: e.target.value }))
                            }
                          />
                          <button
                            type="submit"
                            className="btn-secondary btn-sm"
                            disabled={busy || !(newSub[service.id] ?? "").trim()}
                          >
                            Add
                          </button>
                        </form>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form
          className="flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newService.trim();
            if (whyNotAServiceName(name)) return;
            void guard(() => api.addPackageService({ name }), `${name} added.`);
            setNewService("");
          }}
        >
          <TextInput
            aria-label="New service"
            placeholder="Add a service, such as Payroll administration"
            value={newService}
            onChange={(e) => setNewService(e.target.value)}
          />
          <button type="submit" className="btn-secondary btn-sm" disabled={busy || !newService.trim()}>
            Add a service
          </button>
        </form>

        {retired.length > 0 && (
          <p className="hint">
            Retired:{" "}
            {retired.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ", "}
                {s.name}{" "}
                <button type="button" className="link" disabled={busy} onClick={() => restore(s.id, s.name)}>
                  bring back
                </button>
              </span>
            ))}
            . A retired service stays on the record of any client who was given it.
          </p>
        )}
      </div>
    </section>
  );
}

function ServicesCard({
  data,
  busy,
  guard,
}: {
  data: SubscriptionCatalogue;
  busy: boolean;
  guard: Guard;
}) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [fee, setFee] = useState("");
  const [basis, setBasis] = useState<FeeBasis>("fixed");
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Additional services</h2>
      </div>
      <div className="space-y-4 p-4">
        <p className="muted">
          Work sold on its own, outside any package. A fee can be fixed, a daily rate,
          or a starting point to be quoted, in either currency. Clients see these and
          can ask for them.
        </p>
        <p className="hint">
          Nothing converts between the two. A piece of work priced in dollars cannot go
          on an invoice in cedis - it is re-quoted, or billed on its own invoice.
        </p>

        {data.services.length > 0 && (
          <div className="divide-y divide-slate-100">
            {data.services.map((service) => (
              <div key={service.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="text-sm font-medium text-slate-800">{service.name}</span>
                {!service.active && (
                  <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
                    Retired
                  </span>
                )}
                {service.summary && (
                  <span className="order-last w-full text-xs text-slate-500">
                    {service.summary}
                  </span>
                )}
                <span className="ml-auto text-sm font-semibold tabular-nums">
                  {describeFee(service.fee, service.fee_basis, (n) =>
                    formatAmount(n, service.currency, { decimals: false }),
                  )}
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void guard(
                      () =>
                        api.editService(service.id, {
                          name: service.name,
                          summary: service.summary ?? "",
                          fee: service.fee,
                          fee_basis: service.fee_basis,
                          currency: currencyOf(service.currency),
                          active: !service.active,
                        }),
                      service.active ? `${service.name} retired.` : `${service.name} restored.`,
                    )
                  }
                >
                  {service.active ? "Retire" : "Restore"}
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-[1fr,7rem,9rem,9rem,auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void guard(
              () =>
                api.addService({
                  name,
                  summary,
                  fee: fee.trim() === "" ? null : Number(fee),
                  fee_basis: basis,
                  currency: currencyOf(currency),
                }),
              `${name} added.`,
            ).then(() => {
              setName("");
              setSummary("");
              setFee("");
            });
          }}
        >
          <Field label="Service">
            {(id) => (
              <TextInput
                id={id}
                required
                value={name}
                placeholder="Statutory audit"
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Fee" hint="Blank to quote it.">
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
            )}
          </Field>
          <Field label="Basis">
            {(id) => (
              <Select
                id={id}
                value={basis}
                onChange={(e) => setBasis(e.target.value as FeeBasis)}
              >
                {options(FEE_BASES, FEE_BASIS_LABELS)}
              </Select>
            )}
          </Field>
          <Field label="Priced in">
            {(id) => (
              <Select
                id={id}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {options(CURRENCIES, CURRENCY_LABELS)}
              </Select>
            )}
          </Field>
          <div className="flex items-end">
            <button type="submit" className="btn-secondary" disabled={busy || !name.trim()}>
              Add
            </button>
          </div>
          <div className="sm:col-span-5">
            <Field label="What it is" hint="One line, shown to the client.">
              {(id) => (
                <TextArea
                  id={id}
                  rows={2}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                />
              )}
            </Field>
          </div>
        </form>
      </div>
    </section>
  );
}
