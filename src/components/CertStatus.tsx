/**
 * Where somebody stands on a certification, as one pill and one line.
 *
 * Both come from shared/certifications.ts rather than from anything on screen, so the
 * badge a person sees on their own page, the row an administrator reads, and the grid
 * in the practice-wide view cannot disagree about whether somebody is certified.
 *
 * The line under the pill counts days rather than saying "soon", because "Expires in
 * 3 days" is something a person acts on and "Expiring soon" is something they scroll
 * past.
 */

import {
  CERT_STATE_LABELS,
  certDetail,
  certState,
  type CertRecord,
  type CertState,
} from "@shared/certifications";

const STYLES: Record<CertState, string> = {
  not_started: "bg-slate-100 text-slate-600",
  in_progress: "bg-amber-50 text-amber-800",
  overdue: "bg-rose-50 text-rose-800",
  certified: "bg-emerald-50 text-emerald-700",
  expiring: "bg-amber-50 text-amber-800",
  expired: "bg-rose-50 text-rose-800",
};

export function CertStatus({
  record,
  today,
  withDetail = true,
}: {
  record: CertRecord;
  today: string;
  withDetail?: boolean;
}) {
  const state = certState(record, today);
  const detail = withDetail ? certDetail(record, today) : null;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`pill ${STYLES[state]}`}>{CERT_STATE_LABELS[state]}</span>
      {detail && <span className="text-xs text-slate-500">{detail}</span>}
    </span>
  );
}
