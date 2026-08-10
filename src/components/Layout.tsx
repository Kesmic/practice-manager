import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { ROLE_LABELS } from "@shared/workflow";
import { useSession } from "../lib/auth";
import { FirmLogo, useFirm } from "../lib/firm";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "./ui";

interface NavItem {
  to: string;
  label: string;
  /** Minimum grade required to see the item. */
  minimum?: "manager" | "partner";
  /** Heading the item sits under in the sidebar. */
  section: string;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", section: "Work" },
  { to: "/tasks", label: "Deliverables", section: "Work" },
  { to: "/clients", label: "Clients", section: "Work" },
  { to: "/engagements", label: "Engagements", section: "Work" },
  { to: "/templates", label: "Job templates", section: "Work" },
  { to: "/reports", label: "Reports", minimum: "manager", section: "Work" },

  { to: "/onboarding", label: "My onboarding", section: "My portal" },
  { to: "/handbook", label: "Employee handbook", section: "My portal" },
  { to: "/my-profile", label: "My details", section: "My portal" },

  { to: "/people", label: "People", minimum: "manager", section: "Administration" },
  { to: "/team", label: "Accounts and grades", minimum: "partner", section: "Administration" },
  {
    to: "/portal-admin",
    label: "Handbook and welcome",
    minimum: "partner",
    section: "Administration",
  },
];

export function Layout() {
  const { user, unread, signOut, can } = useSession();
  const { branding } = useFirm();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const visible = NAV.filter((item) => !item.minimum || can(item.minimum));
  // Preserve the declared section order rather than relying on object key order.
  const sections = ["Work", "My portal", "Administration"].filter((section) =>
    visible.some((item) => item.section === section),
  );

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
        <div className="flex items-center gap-2.5 px-5 py-4">
          <FirmLogo className="h-9 w-9 bg-panel/10 p-1" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-white">
              {branding.firm_name}
            </p>
            <p className="text-[11px] text-white/60">Practice Manager</p>
          </div>
        </div>

        <nav className="px-2 pb-4">
          {sections.map((section) => (
            <div key={section} className="mb-3">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                {section}
              </p>
              {visible
                .filter((item) => item.section === section)
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? "bg-panel/15 font-semibold text-white"
                          : "text-white/80 hover:bg-panel/10 hover:text-white"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* --------------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-panel px-4 py-2.5">
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
            <div className="hidden sm:block">
              <ThemeToggle compact />
            </div>
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
