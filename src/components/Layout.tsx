import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ROLE_LABELS } from "@shared/workflow";
import { useSession } from "../lib/auth";
import { FirmLogo, FirmName } from "../lib/firm";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "./ui";

interface NavItem {
  to: string;
  label: string;
  /**
   * Opens a particular tab of a multi-tab page. Two entries may point at the
   * same route this way: settings pages collect several jobs behind tabs, and a
   * job nobody can name from the sidebar is a job nobody finds.
   */
  tab?: string;
  /** Minimum grade required to see the item. */
  minimum?: "manager" | "partner";
  /** Heading the item sits under in the sidebar. */
  section: string;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", section: "Work" },
  { to: "/tasks", label: "Deliverables", section: "Work" },
  { to: "/clients", label: "Clients", section: "Work" },
  {
    to: "/client-requests",
    label: "Client requests",
    minimum: "manager",
    section: "Work",
  },
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
    label: "Portal settings",
    minimum: "partner",
    section: "Administration",
  },
  {
    to: "/portal-admin",
    tab: "email",
    label: "Email notifications",
    minimum: "partner",
    section: "Administration",
  },
];

export function Layout() {
  const { user, unread, signOut, can } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const visible = NAV.filter((item) => !item.minimum || can(item.minimum));

  const openTab = new URLSearchParams(location.search).get("tab");
  const href = (item: NavItem) => (item.tab ? `${item.to}?tab=${item.tab}` : item.to);
  /**
   * Which entry to light up. A path match alone is not enough, because two
   * entries can share a route: there the tab decides, the entry naming the open
   * tab wins, and the plain entry owns every other tab. This is why the sidebar
   * uses Link rather than NavLink, whose own matching looks at the path only.
   */
  const isCurrent = (item: NavItem) => {
    const onPath =
      item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
    if (!onPath) return false;
    const siblings = NAV.filter((other) => other.to === item.to);
    if (siblings.length < 2) return true;
    return item.tab
      ? item.tab === openTab
      : !siblings.some((other) => other.tab && other.tab === openTab);
  };
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
        {/*
          The sidebar is 15rem wide, so a wordmark gets 10rem and the rest is
          breathing room. On this navy the logo needs its white plate.
        */}
        <div className="flex flex-col gap-1.5 px-5 py-4">
          <FirmLogo maxWidth="max-w-[9.5rem]" maxHeight="max-h-12" onDark labelled />
          <FirmName className="truncate text-sm font-semibold text-white" />
          <p className="text-[11px] uppercase tracking-wider text-white/50">
            Practice Manager
          </p>
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
                  <Link
                    key={href(item)}
                    to={href(item)}
                    onClick={() => setMenuOpen(false)}
                    aria-current={isCurrent(item) ? "page" : undefined}
                    className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                      isCurrent(item)
                        ? "bg-panel/15 font-semibold text-white"
                        : "text-white/80 hover:bg-panel/10 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
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
