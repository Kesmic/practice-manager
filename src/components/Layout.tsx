import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { ROLE_LABELS } from "@shared/workflow";
import { useSession } from "../lib/auth";
import { Avatar } from "./ui";

interface NavItem {
  to: string;
  label: string;
  /** Minimum grade required to see the item. */
  minimum?: "manager" | "partner";
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard" },
  { to: "/tasks", label: "Deliverables" },
  { to: "/clients", label: "Clients" },
  { to: "/engagements", label: "Engagements" },
  { to: "/templates", label: "Job templates" },
  { to: "/reports", label: "Reports", minimum: "manager" },
  { to: "/team", label: "Team", minimum: "partner" },
];

export function Layout() {
  const { user, unread, signOut, can } = useSession();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const visible = NAV.filter((item) => !item.minimum || can(item.minimum));

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen lg:flex">
      {/* ------------------------------------------------------------ sidebar */}
      <aside
        className={`${
          menuOpen ? "block" : "hidden"
        } shrink-0 border-b border-slate-800 bg-brand-900 lg:block lg:w-60 lg:border-b-0`}
      >
        <div className="flex items-center gap-2 px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-white/10 text-sm font-bold text-white">
            K
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">Kesmic</p>
            <p className="text-[11px] text-brand-200">Practice Manager</p>
          </div>
        </div>

        <nav className="px-2 pb-4">
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-white/15 font-semibold text-white"
                    : "text-brand-100 hover:bg-white/10 hover:text-white"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* --------------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          <button
            type="button"
            className="btn-ghost btn-sm lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
          >
            ☰ Menu
          </button>

          <div className="hidden text-sm text-slate-500 lg:block">
            {user && (
              <>
                Signed in as{" "}
                <span className="font-medium text-slate-700">{user.full_name}</span> ·{" "}
                {ROLE_LABELS[user.role]}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/notifications"
              className="btn-secondary btn-sm relative"
              title="Notifications"
            >
              Inbox
              {unread > 0 && (
                <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <Link to="/account" className="btn-ghost btn-sm" title="Your account">
              <Avatar name={user?.full_name} />
            </Link>
            <button type="button" onClick={handleSignOut} className="btn-secondary btn-sm">
              Sign out
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">
          <Outlet />
        </main>

        <footer className="px-4 py-4 text-center text-xs text-slate-400 sm:px-6">
          Kesmic Consulting · Practice Manager · Internal system
        </footer>
      </div>
    </div>
  );
}
