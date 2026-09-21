/**
 * The shell around every client-facing page.
 *
 * Not the staff Layout, and not a variant of it. A client sees their own business's
 * name, four links, and nothing that hints at what the rest of the portal holds - the
 * same line the public intake page already draws, for the same reason: the portal should
 * not tell somebody outside the firm about the firm's other work.
 */

import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "./ui";
import { ClientSessionProvider, useClientSession } from "../lib/client-auth";

const LINKS = [
  { to: "/client", label: "My subscription", end: true },
  { to: "/client/invoices", label: "Invoices" },
  { to: "/client/account", label: "My details" },
];

function Shell() {
  const { user, loading, signOut } = useClientSession();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session" />;
  if (!user) {
    return <Navigate to="/client/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-slate-200 bg-panel">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-link">
              {user.client_name}
            </p>
            <p className="text-xs text-slate-500">{user.client_code}</p>
          </div>
          <nav className="flex flex-wrap gap-1">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm ${
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
            <span className="hidden text-xs text-slate-500 sm:inline">{user.full_name}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="mx-auto max-w-4xl px-4 pb-8 text-center text-xs text-slate-400">
        If anything here looks wrong, tell us rather than the portal - we would rather fix
        it than have you work around it.
      </footer>
    </div>
  );
}

/** The provider sits outside the shell so the sign-in page can use the session too. */
export function ClientPortal() {
  return (
    <ClientSessionProvider>
      <Shell />
    </ClientSessionProvider>
  );
}

/** For the pages that sit outside the shell: sign in, and accepting an invitation. */
export function ClientPublic({ children }: { children: React.ReactNode }) {
  return <ClientSessionProvider>{children}</ClientSessionProvider>;
}
