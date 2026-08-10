import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ClientRequestSummary, ClientSummary } from "@shared/types";
import {
  REQUEST_KINDS,
  REQUEST_KIND_LABELS,
  REQUEST_KIND_PURPOSE,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  acceptRequirement,
  isOpenRequest,
  type RequestKind,
} from "@shared/intake";
import { ENTITY_TYPE_LABELS, SERVICE_LINE_LABELS } from "@shared/workflow";
import type { IntakeLink } from "@shared/intake";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { formatDate, formatDateTime } from "../lib/format";
import {
  DetailRow,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Select,
  Spinner,
  SuccessBanner,
  TextArea,
} from "../components/ui";

/**
 * Client intake: the two links, and the queue of what has come through them.
 *
 * The links and the requests live on one screen deliberately. A link nobody has
 * copied anywhere produces no requests, and a queue with nothing in it usually means
 * the link was never sent rather than that no one wants the firm's services. Putting
 * them together makes that obvious.
 */
export function ClientRequests() {
  const [requests, setRequests] = useState<ClientRequestSummary[] | null>(null);
  const [status, setStatus] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [open, setOpen] = useState(0);
  const [selected, setSelected] = useState<ClientRequestSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.clientRequests({ status: status || undefined, kind: kind || undefined });
      setRequests(res.requests);
      setOpen(res.open);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load requests.");
      setRequests([]);
    }
  }, [status, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">Client requests</h1>
        <p className="muted mt-0.5">
          Two links you can send out, and everything that has arrived through them.
          {open > 0 && (
            <>
              {" "}
              <strong className="text-slate-700">
                {open} waiting for a decision.
              </strong>
            </>
          )}
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      <IntakeLinks setError={setError} setNotice={setNotice} />

      <section className="card">
        <div className="card-header flex-wrap gap-2">
          <h2 className="card-title">The queue</h2>
          <div className="flex flex-wrap gap-2">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
              className="w-auto"
            >
              <option value="">Every status</option>
              {REQUEST_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {REQUEST_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              aria-label="Filter by kind"
              className="w-auto"
            >
              <option value="">Both links</option>
              {REQUEST_KINDS.map((value) => (
                <option key={value} value={value}>
                  {REQUEST_KIND_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {requests === null ? (
          <Spinner label="Loading requests" />
        ) : !requests.length ? (
          <EmptyState
            title="Nothing has come in yet"
            description="When somebody submits one of the two forms above, it appears here and everyone at Manager grade and above is notified."
          />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Who</th>
                  <th>Wants</th>
                  <th>Arrived</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} className={isOpenRequest(req.status) ? "" : "opacity-70"}>
                    <td className="whitespace-nowrap font-mono text-xs">{req.reference}</td>
                    <td className="min-w-48">
                      <p className="font-medium text-slate-800">{req.organisation}</p>
                      <p className="text-xs text-slate-500">
                        {req.contact_name} · {req.contact_email}
                      </p>
                      <span className="pill mt-1 bg-slate-100 text-slate-600 ring-slate-200">
                        {REQUEST_KIND_LABELS[req.kind]}
                      </span>
                    </td>
                    <td className="min-w-40 text-xs">
                      {req.services.map((s) => SERVICE_LINE_LABELS[s]).join(", ") || "-"}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {formatDate(req.created_at)}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className={`pill ${REQUEST_STATUS_STYLES[req.status]}`}>
                        {REQUEST_STATUS_LABELS[req.status]}
                      </span>
                      {req.client_name && (
                        <p className="mt-1 text-xs text-slate-500">{req.client_name}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setSelected(req)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <RequestModal
          request={selected}
          onClose={() => setSelected(null)}
          onDone={async (message) => {
            setSelected(null);
            setNotice(message);
            await load();
          }}
          setError={setError}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The two links, with a copy button on each.
 *
 * Copying is the only thing anyone will do here nine times out of ten, so it is one
 * button and not behind anything. Rotation sits behind a confirmation because it
 * breaks a link that may be printed on a proposal.
 */
function IntakeLinks({
  setError,
  setNotice,
}: {
  setError: (m: string | null) => void;
  setNotice: (m: string | null) => void;
}) {
  const [links, setLinks] = useState<IntakeLink[] | null>(null);
  const [copied, setCopied] = useState<RequestKind | null>(null);
  const [rotating, setRotating] = useState<RequestKind | null>(null);

  useEffect(() => {
    api
      .intakeLinks()
      .then((res) => setLinks(res.links))
      .catch((err) =>
        setError(err instanceof ApiRequestError ? err.message : "Could not load the links."),
      );
  }, [setError]);

  const copy = async (link: IntakeLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.kind);
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      // Clipboard access can be refused, and the address is on screen anyway.
      setError("Your browser would not let the page copy. Select the address and copy it by hand.");
    }
  };

  const rotate = async (kind: RequestKind) => {
    setRotating(null);
    try {
      const res = await api.rotateIntakeLink(kind);
      setLinks((prev) =>
        (prev ?? []).map((link) => (link.kind === kind ? res.link : link)),
      );
      setNotice(
        `The ${REQUEST_KIND_LABELS[kind].toLowerCase()} link has been replaced. The old address stopped working immediately, so send the new one to anyone who needs it.`,
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not replace the link.");
    }
  };

  if (!links) return <Spinner label="Loading your links" />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {links.map((link) => (
        <section key={link.kind} className="card p-5">
          <h2 className="card-title">{REQUEST_KIND_LABELS[link.kind]} link</h2>
          <p className="hint mt-1">{REQUEST_KIND_PURPOSE[link.kind]}</p>

          <div className="mt-3 flex items-center gap-2 rounded-md bg-slate-100 p-2">
            <code className="scroll-x flex-1 whitespace-nowrap px-1 text-xs text-slate-700">
              {link.url}
            </code>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={() => void copy(link)}>
              {copied === link.kind ? "Copied" : "Copy link"}
            </button>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary btn-sm"
            >
              Preview
            </a>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setRotating(link.kind)}
            >
              Replace
            </button>
          </div>

          {link.created_at && (
            <p className="hint mt-2">In use since {formatDate(link.created_at)}.</p>
          )}
        </section>
      ))}

      <Modal
        open={rotating !== null}
        title="Replace this link?"
        onClose={() => setRotating(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRotating(null)}>
              Keep the current one
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => rotating && void rotate(rotating)}
            >
              Replace it
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          A new address is generated and the current one stops working at once. Anyone
          who has the old link, including on a website page or a proposal you have
          already sent, will see a message telling them to ask you for a new one.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Do this if a link has been forwarded somewhere it should not have been, or if
          it is attracting rubbish. Requests already received are not affected.
        </p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Everything one submission contains, and the three things you can do with it. */
function RequestModal({
  request,
  onClose,
  onDone,
  setError,
}: {
  request: ClientRequestSummary;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  setError: (m: string | null) => void;
}) {
  const navigate = useNavigate();
  const { can } = useSession();
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useState(request.client_id ?? "");
  const [note, setNote] = useState(request.decision_note ?? "");
  const [busy, setBusy] = useState(false);

  // Only needed to match an existing client, so only loaded then.
  useEffect(() => {
    if (request.kind !== "existing") return;
    void api
      .clients()
      .then((res) => setClients(res.clients))
      .catch(() => setClients([]));
  }, [request.kind]);

  const suggestion = useMemo(() => {
    if (request.kind !== "existing" || !clients.length) return null;
    const wanted = request.organisation.trim().toLowerCase();
    // A suggestion, never a match: it fills the box and the person still confirms.
    return (
      clients.find((c) => c.name.trim().toLowerCase() === wanted) ??
      clients.find((c) => c.code.toLowerCase() === (request.client_ref ?? "").toLowerCase()) ??
      null
    );
  }, [clients, request]);

  useEffect(() => {
    if (suggestion && !clientId) setClientId(suggestion.id);
  }, [suggestion, clientId]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      await onDone(await fn());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const takeOn = () =>
    act(async () => {
      await api.updateClientRequest(request.id, { status: "in_review", decision_note: note });
      return `${request.reference} is marked as yours. It stays in the queue until you accept or decline it.`;
    });

  const decline = () =>
    act(async () => {
      await api.updateClientRequest(request.id, { status: "declined", decision_note: note });
      return `${request.reference} is declined. Nobody outside the firm is told; write to them yourself.`;
    });

  const accept = () =>
    act(async () => {
      const res = await api.acceptClientRequest(request.id, {
        client_id: clientId || undefined,
        decision_note: note,
      });
      window.setTimeout(() => navigate(`/clients/${res.client_id}`), 900);
      return res.created_client
        ? `${request.reference} accepted, and ${request.organisation} now has a client record as a prospect. Opening it.`
        : `${request.reference} accepted and matched. Opening the client.`;
    });

  return (
    <Modal
      open
      title={`${request.reference} · ${request.organisation}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          {request.status !== "declined" && request.status !== "accepted" && (
            <>
              {request.status === "new" && (
                <button type="button" className="btn-secondary" onClick={takeOn} disabled={busy}>
                  I am looking at this
                </button>
              )}
              <button type="button" className="btn-danger" onClick={decline} disabled={busy}>
                Decline
              </button>
              <button type="button" className="btn-primary" onClick={accept} disabled={busy}>
                {busy ? "Working…" : "Accept"}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`pill ${REQUEST_STATUS_STYLES[request.status]}`}>
            {REQUEST_STATUS_LABELS[request.status]}
          </span>
          <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
            {REQUEST_KIND_LABELS[request.kind]} link
          </span>
          <span className="text-xs text-slate-500">
            Arrived {formatDateTime(request.created_at)}
          </span>
        </div>

        {/*
          Said plainly and at the top: everything below was typed by somebody outside
          the firm. A tax number here is a claim, not a fact, and accepting the
          request copies it into the client record as it stands.
        */}
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          Every detail below was typed by the sender. Check anything you intend to rely
          on, particularly registration and tax numbers.
        </p>

        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold text-slate-700">What they asked for</h3>
          <div className="flex flex-wrap gap-1.5">
            {request.services.length ? (
              request.services.map((service) => (
                <span key={service} className="pill bg-brand-50 text-link ring-brand-200">
                  {SERVICE_LINE_LABELS[service]}
                </span>
              ))
            ) : (
              <span className="muted text-sm">Nothing was ticked.</span>
            )}
          </div>
          {request.details && (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              {request.details}
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-1.5 text-sm font-semibold text-slate-700">Contact</h3>
          <dl className="divide-y divide-slate-100">
            <DetailRow label="Name">{request.contact_name}</DetailRow>
            <DetailRow label="Email">
              <a className="link" href={`mailto:${request.contact_email}`}>
                {request.contact_email}
              </a>
            </DetailRow>
            <DetailRow label="Telephone">{request.contact_phone ?? "Not given"}</DetailRow>
            <DetailRow label="Preferred start">
              {request.preferred_start ? formatDate(request.preferred_start) : "Not given"}
            </DetailRow>
          </dl>
        </section>

        {request.kind === "new" ? (
          <section>
            <h3 className="mb-1.5 text-sm font-semibold text-slate-700">
              Organisation, as submitted
            </h3>
            <dl className="divide-y divide-slate-100">
              <DetailRow label="Name">{request.organisation}</DetailRow>
              <DetailRow label="Entity type">
                {request.entity_type
                  ? ENTITY_TYPE_LABELS[request.entity_type]
                  : "Not given"}
              </DetailRow>
              <DetailRow label="Industry">{request.industry ?? "Not given"}</DetailRow>
              <DetailRow label="Tax identification">{request.tax_id ?? "Not given"}</DetailRow>
              <DetailRow label="Registration number">
                {request.registration_no ?? "Not given"}
              </DetailRow>
              <DetailRow label="Financial year end">
                {request.fiscal_year_end ?? "Not given"}
              </DetailRow>
              <DetailRow label="Address">{request.address ?? "Not given"}</DetailRow>
            </dl>
          </section>
        ) : (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Which client is this?</h3>
            <dl className="divide-y divide-slate-100">
              <DetailRow label="Name they gave">{request.organisation}</DetailRow>
              <DetailRow label="Reference they gave">
                {request.client_ref ?? "Not given"}
              </DetailRow>
            </dl>
            <Field
              label="Client file"
              hint={
                suggestion
                  ? `Suggested from the name they typed. Confirm it is the right file before accepting.`
                  : "Nothing matched what they typed, which is normal. Choose the right file."
              }
            >
              {(id) => (
                <Select id={id} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Not matched yet</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.code} · {client.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </section>
        )}

        <Field
          label="Note for the file"
          hint="Why you accepted or declined, and anything the next person should know. Kept with the request."
        >
          {(id) => (
            <TextArea
              id={id}
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>

        <p className="hint">{acceptRequirement(request.kind)}</p>

        {request.status === "accepted" && request.client_id && (
          <p className="text-sm">
            Accepted{request.handled_by_name ? ` by ${request.handled_by_name}` : ""}
            {request.handled_at ? ` on ${formatDate(request.handled_at)}` : ""}.{" "}
            <Link className="link" to={`/clients/${request.client_id}`}>
              Open {request.client_name ?? "the client"}
            </Link>
          </p>
        )}

        {!can("manager") && (
          <p className="hint">
            Accepting and declining need Manager grade or above.
          </p>
        )}
      </div>
    </Modal>
  );
}
