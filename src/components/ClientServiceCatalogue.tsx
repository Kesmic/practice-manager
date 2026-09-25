/**
 * The one-off services a client can ask for, and what they have asked for so far.
 *
 * Thirty-odd pieces of work in one list, each with a price that reads "quoted on
 * request" and its own button, is a price list from a fax machine. A client does not
 * read a catalogue top to bottom; they come with a need ("VAT", "a valuation", "the
 * ORC") and want to find it. So this is laid out the way a person looks: a search box,
 * the service lines as tabs, and each piece of work as a card with room to say what it
 * is. The price is quiet where there is none yet and clear where there is.
 *
 * Each card turns over: the front is the name and the price, the back is what the work
 * covers, the way the package cards do it. Asking is a small conversation rather than a
 * button that fires. The dialog says what
 * they are asking about, lets them add a line about their situation, and only then
 * sends it. Nothing here commits the client to anything - a fee comes back from the
 * firm and waits for their answer - and the copy says so where they will read it.
 *
 * Their requests and the firm's proposals sit together underneath, the quote waiting
 * on them first, because that is the one thing on this page that needs a decision.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { AdditionalService, ClientServiceRow } from "@shared/types";
import { SERVICE_STATE_CLIENT_LABELS, describeFee, type ServiceState } from "@shared/subscriptions";
import { SERVICE_LINES, SERVICE_LINE_LABELS, type ServiceLine } from "@shared/workflow";
import { Modal, TextArea } from "./ui";
import { formatDate, formatMoney } from "../lib/format";

/** Shown before the whole catalogue is asked for, so the page does not open on a wall. */
const FIRST_PAGE = 9;

/** A request still in play; asking for the same thing again is refused by the API. */
const IN_PLAY: ServiceState[] = ["requested", "quoted", "agreed"];

/** The order the requests are read in: the one waiting on the client first. */
const STATE_ORDER: Record<ServiceState, number> = {
  quoted: 0,
  requested: 1,
  agreed: 2,
  delivered: 3,
  declined: 4,
};

const STATE_STYLE: Record<ServiceState, string> = {
  quoted: "bg-amber-50 text-amber-800 ring-amber-200",
  requested: "bg-slate-100 text-slate-700 ring-slate-200",
  agreed: "bg-teal-50 text-teal-800 ring-teal-200",
  delivered: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  declined: "bg-slate-50 text-slate-500 ring-slate-200",
};

/** The catalogue: search, service-line tabs, cards, and the dialog that sends a request. */
export function ClientServiceCatalogue({
  available,
  services,
  busy,
  onAsk,
}: {
  available: AdditionalService[];
  services: ClientServiceRow[];
  busy: string | null;
  onAsk: (serviceId: string, name: string, note: string | undefined) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [line, setLine] = useState<ServiceLine | "all" | "other">("all");
  const [showAll, setShowAll] = useState(false);
  const [asking, setAsking] = useState<AdditionalService | null>(null);
  const pick = (next: ServiceLine | "all" | "other") => {
    setLine(next);
    setQuery("");
  };

  /*
   * What is already with the firm, by name. A request keeps the name it was asked
   * under, so a card for something in play says so rather than offering it again.
   */
  const inPlay = useMemo(
    () => new Set(services.filter((s) => IN_PLAY.includes(s.status)).map((s) => s.name)),
    [services],
  );

  const lines = SERVICE_LINES.filter((l) => available.some((s) => s.service_line === l));
  const unlisted = available.some((s) => !SERVICE_LINES.includes(s.service_line as ServiceLine));

  const needle = query.trim().toLowerCase();
  const matches = available.filter((s) => {
    if (line === "other") {
      if (SERVICE_LINES.includes(s.service_line as ServiceLine)) return false;
    } else if (line !== "all" && s.service_line !== line) return false;
    if (!needle) return true;
    return (
      s.name.toLowerCase().includes(needle) ||
      (s.summary ?? "").toLowerCase().includes(needle) ||
      lineLabel(s.service_line).toLowerCase().includes(needle)
    );
  });
  /*
   * Read in the order the firm's lines are listed, then the firm's own order within a
   * line, so "All" groups like with like rather than following the seed order.
   */
  matches.sort(
    (a, b) =>
      lineIndex(a.service_line) - lineIndex(b.service_line) || a.position - b.position,
  );
  const browsing = line === "all" && !needle;
  const shown = browsing && !showAll ? matches.slice(0, FIRST_PAGE) : matches;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="card-title">Additional services</h2>
          <p className="muted mt-1 max-w-2xl">
            Work we do outside your package. Tell us what you need and we will come back
            with a fee before anything starts.
          </p>
        </div>
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search additional services</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          >
            <path
              fill="currentColor"
              d="M8.5 3a5.5 5.5 0 0 1 4.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 1 1 8.5 3Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
            />
          </svg>
          <input
            type="search"
            className="input pl-9"
            placeholder="Search, e.g. VAT, valuation, ORC"
            value={query}
            onChange={(e) => {
              // A search looks across the whole catalogue; a tab narrows it. One at a time.
              setQuery(e.target.value);
              setLine("all");
            }}
          />
        </label>
      </div>

      {/* The service lines as tabs. They wrap on a desk and scroll sideways on a phone. */}
      <div className="-mx-5 mt-4 overflow-x-auto px-5 scroll-x sm:overflow-visible">
        <div className="flex w-max gap-2 pb-1 sm:w-auto sm:flex-wrap">
          <Tab active={line === "all"} onClick={() => pick("all")}>
            All <Count n={available.length} />
          </Tab>
          {lines.map((l) => (
            <Tab key={l} active={line === l} onClick={() => pick(l)}>
              {SERVICE_LINE_LABELS[l]}{" "}
              <Count n={available.filter((s) => s.service_line === l).length} />
            </Tab>
          ))}
          {unlisted && (
            <Tab active={line === "other"} onClick={() => pick("other")}>
              Other
            </Tab>
          )}
        </div>
      </div>

      {matches.length === 0 ? (
        <p className="muted mt-6 text-center">
          Nothing matches "{query.trim()}". Ask us anyway - if we do it, we will quote it.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              withUs={inPlay.has(service.name)}
              onAsk={() => setAsking(service)}
            />
          ))}
        </div>
      )}

      {browsing && matches.length > FIRST_PAGE && (
        <div className="mt-4 text-center">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${matches.length} services`}
          </button>
        </div>
      )}

      <AskDialog
        service={asking}
        busy={busy === asking?.id}
        onClose={() => setAsking(null)}
        onSend={async (note) => {
          if (!asking) return;
          await onAsk(asking.id, asking.name, note);
          setAsking(null);
        }}
      />
    </section>
  );
}

function lineIndex(line: string | null): number {
  const i = SERVICE_LINES.indexOf(line as ServiceLine);
  return i === -1 ? SERVICE_LINES.length : i;
}

function lineLabel(line: string | null): string {
  return SERVICE_LINES.includes(line as ServiceLine)
    ? SERVICE_LINE_LABELS[line as ServiceLine]
    : "Other";
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
        active
          ? "bg-brand-600 text-white ring-brand-600"
          : "bg-panel text-slate-600 ring-slate-300 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-0.5 opacity-70 tabular-nums">{n}</span>;
}

/**
 * One piece of work as a card that turns over: the front is the name and the price,
 * the back is what it covers and the way to ask. The same turn as the package cards -
 * on hover, on keyboard focus and on a tap - so it works on a phone as well as a desk.
 */
function ServiceCard({
  service,
  withUs,
  onAsk,
}: {
  service: AdditionalService;
  withUs: boolean;
  onAsk: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const turned = pinned || hovered;
  const priced = service.fee !== null;
  const fee = priced
    ? capitalise(describeFee(service.fee, service.fee_basis, (n) => formatMoney(n, service.currency)))
    : "Fee on request";
  return (
    <div
      className={`flip lift h-52 ${turned ? "is-turned" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flip-inner h-full">
        {/* ------------------------------------------------- the front */}
        <button
          type="button"
          aria-expanded={turned}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          onClick={() => setPinned((v) => !v)}
          className="flip-face flex h-full w-full flex-col rounded-lg bg-panel p-4 text-left ring-1 ring-inset ring-slate-200 hover:ring-brand-300"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {lineLabel(service.service_line)}
          </span>
          <h3 className="mt-1 text-base font-semibold leading-snug text-slate-900">{service.name}</h3>
          <div className="mt-auto">
            <span
              className={
                priced ? "text-sm font-semibold tabular-nums text-slate-900" : "text-xs text-slate-400"
              }
            >
              {fee}
            </span>
            <p className="mt-1.5 text-xs font-medium text-link">
              {withUs ? "With us - turn it over" : "What this covers - turn it over"}
            </p>
          </div>
        </button>

        {/* -------------------------------------------------- the back */}
        <div className="flip-face flip-back flex flex-col rounded-lg bg-panel p-4 ring-1 ring-inset ring-brand-300">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{service.name}</h3>
            <button
              type="button"
              className="btn-ghost btn-sm ml-auto -mr-2 -mt-1"
              onClick={() => {
                setPinned(false);
                setHovered(false);
              }}
              onFocus={() => setHovered(true)}
              onBlur={() => setHovered(false)}
            >
              Back
            </button>
          </div>
          <p className="mt-1 flex-1 overflow-auto text-sm leading-6 text-slate-600">
            {service.summary ?? "Ask us and we will tell you what this covers for your business."}
          </p>
          <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
            <span className={priced ? "text-sm font-semibold tabular-nums text-slate-900" : "text-xs text-slate-400"}>
              {fee}
            </span>
            {withUs ? (
              <span className="pill bg-slate-100 text-slate-600 ring-slate-200">With us</span>
            ) : (
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={onAsk}
                onFocus={() => setHovered(true)}
                onBlur={() => setHovered(false)}
              >
                Ask us
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The conversation before a request goes. What they are asking about, a line about
 * their situation if they want to give one, and what happens next.
 */
function AskDialog({
  service,
  busy,
  onClose,
  onSend,
}: {
  service: AdditionalService | null;
  busy: boolean;
  onClose: () => void;
  onSend: (note: string | undefined) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const open = service !== null;
  if (!service) return null;
  const priced = service.fee !== null;
  return (
    <Modal
      open={open}
      title={`Ask us about ${service.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void onSend(note.trim() || undefined)}
          >
            {busy ? "Sending..." : "Send to the firm"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {service.summary && <p className="text-sm text-slate-700">{service.summary}</p>}
        <p className="text-sm text-slate-600">
          {priced ? (
            <>
              <span className="font-semibold text-slate-900">
                {capitalise(describeFee(service.fee, service.fee_basis, (n) => formatMoney(n, service.currency)))}
              </span>
              . We will confirm the fee for your case before anything starts.
            </>
          ) : (
            "We will come back to you with a fee before anything starts. Nothing is charged until you accept it."
          )}
        </p>
        <div>
          <label htmlFor="ask-note" className="label">
            Anything we should know? <span className="font-normal normal-case text-slate-400">Optional</span>
          </label>
          <TextArea
            id="ask-note"
            rows={3}
            maxLength={500}
            placeholder="Which year, how many people, when you need it by..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

/** What the client has asked for and what the firm has proposed, the quote waiting on them first. */
export function ClientServiceRequests({
  services,
  busy,
  onDecide,
}: {
  services: ClientServiceRow[];
  busy: string | null;
  onDecide: (id: string, status: "agreed" | "declined") => Promise<void>;
}) {
  if (services.length === 0) return null;
  const ordered = [...services].sort((a, b) => STATE_ORDER[a.status] - STATE_ORDER[b.status]);
  const waiting = ordered.filter((s) => s.status === "quoted").length;
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="card-title">Your requests and quotes</h2>
        {waiting > 0 && (
          <span className="pill bg-amber-50 text-amber-800 ring-amber-200">
            {waiting === 1 ? "1 quote waiting for you" : `${waiting} quotes waiting for you`}
          </span>
        )}
      </div>
      <p className="muted mt-1">
        Nothing starts, and nothing is charged, until you accept a quote.
      </p>
      <ul className="mt-4 space-y-3">
        {ordered.map((service) => (
          <RequestRow key={service.id} service={service} busy={busy === service.id} onDecide={onDecide} />
        ))}
      </ul>
    </section>
  );
}

function RequestRow({
  service,
  busy,
  onDecide,
}: {
  service: ClientServiceRow;
  busy: boolean;
  onDecide: (id: string, status: "agreed" | "declined") => Promise<void>;
}) {
  const quoted = service.status === "quoted";
  const proposed = service.requested_at === null;
  /* One line of history: who started it and when, or where it got to. */
  const when =
    service.status === "delivered"
      ? `Done ${formatDate(service.delivered_at)}`
      : service.status === "declined"
        ? `Closed ${formatDate(service.decided_at)}`
        : service.status === "agreed"
          ? `Agreed ${formatDate(service.decided_at)}`
          : proposed
            ? `Proposed by us ${formatDate(service.quoted_at)}`
            : `You asked ${formatDate(service.requested_at)}`;
  return (
    <li
      className={`rounded-lg p-4 ring-1 ${
        quoted ? "bg-amber-50/40 ring-amber-200" : "bg-panel ring-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{service.name}</h3>
            <span className={`pill ${STATE_STYLE[service.status]}`}>
              {SERVICE_STATE_CLIENT_LABELS[service.status]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{when}</p>
          {service.note && (
            <p className="mt-2 border-l-2 border-slate-200 pl-3 text-sm text-slate-600">
              {service.note}
            </p>
          )}
        </div>
        {service.quoted_fee !== null && (
          <div className="text-right">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {quoted ? "Our quote" : "Fee"}
            </span>
            <span className="text-lg font-semibold tabular-nums text-slate-900">
              {formatMoney(service.quoted_fee, service.currency)}
            </span>
          </div>
        )}
      </div>
      {/*
        The only decision a client makes here. Everything else on a request is the
        firm's, and the fee is never read from anything the client sends.
      */}
      {quoted && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-amber-200/70 pt-3">
          <span className="mr-auto text-xs text-slate-600">
            Happy with this? Say so and we will start.
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => void onDecide(service.id, "declined")}
          >
            Not now
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={busy}
            onClick={() => void onDecide(service.id, "agreed")}
          >
            {busy ? "Saving..." : "Go ahead"}
          </button>
        </div>
      )}
    </li>
  );
}
