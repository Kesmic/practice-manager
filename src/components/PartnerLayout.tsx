/**
 * The shell around every growth partner page.
 *
 * Neither the staff Layout nor the client one. A growth partner sees their own name,
 * three links and what the arrangement pays them - and nothing that hints at the firm's
 * other partners, other clients, or what anybody else earns.
 */

import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "./ui";
import { PartnerSessionProvider, usePartnerSession } from "../lib/partner-auth";

const LINKS = [
  { to: "/partner", label: "My pipeline", end: true },
  { to: "/partner/earnings", label: "What I have earned" },
  { to: "/partner/engagement", label: "My engagement" },
  { to: "/partner/account", label: "My details" },
];

function Shell() {
  const { partner, loading, signOut } = usePartnerSession();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session" />;
  if (!partner) {
    return <Navigate to="/partner/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-slate-200 bg-panel">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-link">
              Growth partner
            </p>
            <p className="text-xs text-slate-500">
              {partner.business_name || partner.full_name}
            </p>
          </div>
          <nav className="flex flex-wrap gap-1">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-brand-50 font-semibold text-link"
                      : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">
              {partner.full_name}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/*
        Said at the top of every page until it is done, because until it is, registering
        a business and sending a proposal are both refused - and a refusal somebody meets
        halfway through typing is a worse way to learn that than a line here.
      */}
      {!partner.agreement_signed_at && (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto max-w-5xl px-4 py-2.5 text-sm text-amber-900">
            <NavLink to="/partner/engagement" className="font-semibold underline">
              Sign your engagement
            </NavLink>{" "}
            before registering a business or sending a proposal. It takes a minute.
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-8 text-center text-xs text-slate-400">
        {partner.commission_rate}% of the subscription for the first{" "}
        {partner.commission_months} billed months. A month a client pauses is not one of
        them.
      </footer>
    </div>
  );
}

export function PartnerPortal() {
  return (
    <PartnerSessionProvider>
      <Shell />
    </PartnerSessionProvider>
  );
}

/** For the pages outside the shell: applying, signing in, setting a password. */
export function PartnerPublic({ children }: { children: React.ReactNode }) {
  return <PartnerSessionProvider>{children}</PartnerSessionProvider>;
}
